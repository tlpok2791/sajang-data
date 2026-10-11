# -*- coding: utf-8 -*-
"""공공데이터 → data/*.json (앱이 읽는 파일) + 바탕화면 검수용 엑셀. 전국.

  점포(분기 갱신): 공공데이터포털 '소상공인시장진흥공단_상가(상권)정보' 전국 파일(zip, CSV 시도별 16개)
                   python export.py stores [zip경로]   (생략하면 다운로드\\상가정보_원본\\*.zip 중 최신)
  인허가(매월):     python export.py lic               (API. 끊기면 다시 실행 → 받은 쪽은 건너뜀)
  메타·엑셀:        python export.py meta
  전부:             python export.py all [zip경로]
  그다음 python publish.py  (gh-pages 브랜치에 최신본 하나만 올림)

메모리를 아끼려고 전부 한 줄씩 읽어 동별 임시파일(.cache)에 쌓은 뒤 동마다 JSON 하나로 묶는다.
키는 이 저장소에 두지 않는다. ../blog-writer_mcp/.env 의 DATA_GO_KR_KEY 를 읽는다.
"""
import collections
import csv
import datetime as dt
import io
import json
import os
import re
import shutil
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / 'blog-writer_mcp' / '.env')
KEY = os.environ.get('DATA_GO_KR_KEY', '')
OUT = HERE / 'data'
CACHE = HERE / '.cache'
LCACHE = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'sajang-data-cache'   # 인허가 원본 페이지(수백만 건). OneDrive 밖에 둔다
DESK = Path.home() / 'OneDrive' / '바탕 화면'
RAW = Path.home() / 'Downloads' / '상가정보_원본'
MONTH = dt.date.today().strftime('%Y-%m')
LOCAL = 'https://apis.data.go.kr/1741000/{}/info'
LICENSE_SVC = {'rest_cafes': '휴게음식점(카페 등)', 'general_restaurants': '일반음식점', 'ecommerce_businesses': '통신판매업(온라인 판매)',
               'beauty_salons': '미용업', 'barber_shops': '이용업', 'clinics': '의원', 'pharmacies': '약국', 'bakeries': '제과점',
               'fitness_centers': '체력단련장', 'lodgings': '숙박업', 'laundries': '세탁업'}   # 승인 안 된 업종은 자동으로 건너뜀
PRIVATE = {'ecommerce_businesses'}      # 개인이 집 주소로 신고하는 업종: 상호·주소를 공개하지 않고 숫자만
CAFE_BZ = {'커피숍', '다방', '전통찻집', '떡카페', '키즈카페'}
CAFE_NM = re.compile(r'카페|까페|커피|coffee|cafe|찻집', re.I)
SPAN = 36                               # 앱에 넘기는 월별 개업·폐업 기간(개월)
# 인허가 주소에는 옛 시도명이 남아 있다 (2026 전남광주통합특별시 등)
SIDO_ALIAS = {'전남광주통합특별시': ['전남광주통합특별시', '전라남도', '광주광역시'], '전라남도': ['전라남도', '전남광주통합특별시'],
              '광주광역시': ['광주광역시', '전남광주통합특별시'], '강원특별자치도': ['강원특별자치도', '강원도'],
              '전북특별자치도': ['전북특별자치도', '전라북도'], '제주특별자치도': ['제주특별자치도', '제주도']}
# 상가정보 CSV 열 위치 (2026-06 파일 기준). 머리글로 매번 확인한다.
C = dict(name=1, brch=2, l=4, m=6, s=8, sido_cd=11, sido=12, sg_cd=13, sg=14, ad_cd=15, ad=16, ld=18, road=31, floor=35)


class NotRegistered(Exception):
    pass


class QuotaExceeded(Exception):
    pass


def get(url, **params):
    for wait in (2, 5, 15, 30, 60, 0):                 # 공공 API는 503(혼잡)을 가끔 낸다 → 쉬었다 재시도
        r = None
        try:
            r = requests.get(url, params={'serviceKey': KEY, **params}, timeout=60)
            if 'SERVICE_KEY_IS_NOT_REGISTERED' in r.text:
                raise NotRegistered(url)
            if 'LIMITED_NUMBER_OF_SERVICE_REQUESTS' in r.text:
                raise QuotaExceeded(url.split('?')[0])
            if r.status_code < 500:
                r.raise_for_status()
                return r.json()
        except (requests.ConnectionError, requests.Timeout, ValueError):
            pass
        if not wait:
            raise RuntimeError(f'{url.split("?")[0]} 계속 실패 (HTTP {getattr(r, "status_code", "-")})')   # 주소에 키가 섞여 로그에 남지 않게
        time.sleep(wait)


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    tmp.replace(path)                                  # 중간에 끊겨도 반쪽 파일이 남지 않게


class Appender:
    """키별 jsonl 파일에 한 줄씩 덧붙인다. 열린 파일은 최대 300개만 유지(메모리·핸들 절약)."""
    def __init__(self, root):
        self.root, self.open = root, collections.OrderedDict()
        shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True)

    def add(self, key, obj):
        f = self.open.pop(key, None) or open(self.root / f'{key}.jsonl', 'a', encoding='utf-8')
        f.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n')
        self.open[key] = f
        if len(self.open) > 300:
            self.open.popitem(last=False)[1].close()

    def close(self):
        for f in self.open.values():
            f.close()


def read_jsonl(p):
    with open(p, encoding='utf-8') as f:
        return [json.loads(line) for line in f]


# ── 점포: 전국 CSV → 동별 JSON ─────────────────────────────────────
def stores(zip_path):
    regions = {}
    app = Appender(CACHE / 'stores')
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if not info.filename.lower().endswith('.csv'):
                continue
            n, sido = 0, ''
            with z.open(info) as fh:
                rd = csv.reader(io.TextIOWrapper(fh, encoding='utf-8-sig'))
                head = next(rd)
                assert head[C['name']] == '상호명' and head[C['ad_cd']] == '행정동코드' and head[C['road']] == '도로명주소', head
                for r in rd:
                    ad = r[C['ad_cd']]
                    if not ad:
                        continue
                    sido = r[C['sido']]
                    sg = regions.setdefault(r[C['sido_cd']], {'name': sido, 'signgu': {}})['signgu'] \
                                .setdefault(r[C['sg_cd']], {'name': r[C['sg']], 'dongs': {}})
                    sg['dongs'][ad] = r[C['ad']]
                    app.add(ad, [r[C['name']], r[C['brch']], r[C['l']], r[C['m']], r[C['s']], r[C['road']], r[C['floor']], r[C['ld']]])
                    n += 1
            print(f'  {sido} {n:,}곳', flush=True)
    app.close()

    summary = []
    shutil.rmtree(OUT / 'dong', ignore_errors=True)
    for sd in regions.values():
        for sg in sd['signgu'].values():
            for ad_cd, ad_nm in sg['dongs'].items():
                rows = read_jsonl(CACHE / 'stores' / f'{ad_cd}.jsonl')
                lds = collections.Counter(x[7] for x in rows if x[7])
                ld = [d for d, k in lds.most_common() if k >= max(1, len(rows) * .05)]   # 점포 5% 이상이 속한 법정동(읍·면)
                dump(OUT / 'dong' / f'{ad_cd}.json', {'month': MONTH, 'adong': ad_nm, 'signgu': sg['name'], 'sido': sd['name'], 'ldongs': ld,
                                                      'stores': [{'n': x[0], 'b': x[1], 'l': x[2], 'm': x[3], 's': x[4], 'a': x[5], 'f': x[6]} for x in rows]})
                summary.append({'시도': sd['name'], '시군구': sg['name'], '행정동': ad_nm, '법정동': ', '.join(ld), '전체': len(rows),
                                **collections.Counter(x[2] for x in rows)})
            sg['dongs'] = sorted(sg['dongs'].items(), key=lambda t: t[1])
    dump(CACHE / 'regions.json', {'source': Path(zip_path).name, 'basis': next(iter(re.findall(r'_(\d{6})\.csv', ' '.join(z.namelist()))), ''),
                                  'regions': regions})
    dump(CACHE / 'store_summary.json', summary)
    print(f'점포: {len(regions)}개 시도, {sum(len(s["signgu"]) for s in regions.values())}개 시군구, {len(summary):,}개 행정동, {sum(x["전체"] for x in summary):,}곳', flush=True)


# ── 인허가: 전국 API → 시군구·법정동별 JSON ─────────────────────────
BIG = 200_000        # 이보다 큰 업종은 깊은 쪽(카페 5,000쪽·음식점 15,000쪽 등)이 60초 넘겨 504 → 지자체(개방자치단체코드)별로 나눠 받는다 (2026-10-11 카페·미용·음식점·통신판매)
BY_CODE = 'cond[OPN_ATMY_GRP_CD::EQ]'


def atmy_codes():
    """개방자치단체코드 목록. 약국 전체(작아서 빠름)에서 모은다 — 큰 업종은 아래 합계 대조로 빠진 코드를 잡는다."""
    f = CACHE / 'atmy_codes.json'
    if not f.exists():
        def pg(p):
            b = get(LOCAL.format('pharmacies'), pageNo=p, numOfRows=100, returnType='json')['response']['body']
            return {x['OPN_ATMY_GRP_CD'] for x in (b['items']['item'] if b['totalCount'] else [])}
        total = get(LOCAL.format('pharmacies'), pageNo=1, numOfRows=1, returnType='json')['response']['body']['totalCount']
        with ThreadPoolExecutor(8) as ex:
            dump(f, sorted(set().union(*ex.map(pg, range(1, total // 100 + 2)))))
    return json.loads(f.read_text(encoding='utf-8'))


def pages_of(svc, total):
    """받을 쪽 목록: 작은 업종은 쪽 번호, 큰 업종은 (지자체코드, 쪽)."""
    if total <= BIG:
        return list(range(1, total // 100 + 2))
    codes = atmy_codes()
    cnt = lambda c: get(LOCAL.format(svc), pageNo=1, numOfRows=1, returnType='json', **{BY_CODE: c})['response']['body']['totalCount']
    with ThreadPoolExecutor(8) as ex:
        per = dict(zip(codes, ex.map(cnt, codes)))
    if sum(per.values()) != total:                   # 지자체 코드가 새로 생기면 여기서 걸린다 → .cache/atmy_codes.json 지우고 다시
        raise RuntimeError(f'{svc} 지자체별 합 {sum(per.values()):,} ≠ 전국 {total:,}')
    for f in (LCACHE / MONTH / svc).glob('?????.json'):  # 예전 방식(전국 쪽 번호)으로 받은 것과 섞이면 중복 집계
        f.unlink()
    return [(c, p) for c, n in per.items() for p in range(1, n // 100 + 2)]


def lic_page(svc, page):
    code, page = page if isinstance(page, tuple) else (None, page)
    p = LCACHE / MONTH / svc / (f'{code}_{page:04d}.json' if code else f'{page:05d}.json')
    if p.exists():
        return
    b = get(LOCAL.format(svc), pageNo=page, numOfRows=100, returnType='json', **({BY_CODE: code} if code else {}))['response']['body']
    items = b['items']['item'] if b['totalCount'] else []
    dump(p, [{'name': x['BPLC_NM'], 'bz': x.get('SNTTN_BZSTAT_NM') or x.get('NTSL_MTH_NM') or x.get('BZSTAT_SE_NM') or '',
              'open': x['LCPMT_YMD'], 'close': x['CLSBIZ_YMD'], 'lot': x['LOTNO_ADDR'], 'road': x['ROAD_NM_ADDR']} for x in items])


def months_back(n):
    """지난달까지 n개월 ['2023-10', …, '2026-09']."""
    y, m = map(int, MONTH.split('-'))
    out = []
    for _ in range(n):
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
        out.append(f'{y}-{m:02d}')
    return out[::-1]


def aggregate(rows, svc):
    """한 법정동의 인허가 이력 → 업태별 월별 개업·폐업 수, 영업 중 수, 3년 생존, 최근 3개월 목록.
    같은 상호가 폐업 후 60일 안에 다시 인허가 = 양도·양수로 보고 개업·폐업 수에서 뺀다."""
    months = months_back(SPAN)
    idx = {m: i for i, m in enumerate(months)}
    norm = lambda t: re.sub(r'\s|\(.*?\)', '', t)
    d = lambda s: dt.date.fromisoformat(s)
    by_name = collections.defaultdict(list)
    for i, r in enumerate(rows):
        by_name[norm(r['name'])].append(i)
    tr = set()
    for ids in by_name.values():
        for a in ids:
            for b in ids:
                if a != b and rows[a]['close'] and rows[b]['open'] and 0 <= (d(rows[b]['open']) - d(rows[a]['close'])).days <= 60:
                    tr |= {a, b}
    y, m = map(int, months[-1].split('-'))
    cut = f'{y - 3}-{m:02d}-31'                            # 3년을 다 지켜본 개업분만 생존율에 넣는다
    recent = set(months[-3:])
    groups = {}
    keys = lambda r: [''] + ([r['bz']] if r['bz'] else []) + (['__cafe'] if svc != 'ecommerce_businesses' and (r['bz'] in CAFE_BZ or CAFE_NM.search(r['name'])) else [])
    for i, r in enumerate(rows):
        for k in keys(r):
            g = groups.setdefault(k, {'op': [0] * SPAN, 'cl': [0] * SPAN, 'live': 0, 'coh': 0, 'dead3': 0, 'new': [], 'gone': []})
            if not r['close']:
                g['live'] += 1
            if i not in tr:
                if r['open'][:7] in idx:
                    g['op'][idx[r['open'][:7]]] += 1
                if r['close'][:7] in idx:
                    g['cl'][idx[r['close'][:7]]] += 1
            if r['open'] and '2015-01-01' <= r['open'] <= cut:
                g['coh'] += 1
                g['dead3'] += bool(r['close']) and (d(r['close']) - d(r['open'])).days < 365 * 3
            if svc not in PRIVATE:
                item = {'name': r['name'], 'open': r['open'], 'close': r['close'], 'addr': r['addr'], 'tr': i in tr}
                if r['open'][:7] in recent:
                    g['new'].append(item)
                if r['close'][:7] in recent:
                    g['gone'].append(item)
    return {'months': months, 'groups': groups}


def locate(lot, road, sg_index):
    """인허가 주소 → (시군구코드, 법정동/읍·면). sg_index: [(접두어 '경기도 수원시 영통구 ', 코드)] 긴 것부터.
    지번: '… 매탄동 416' / '… 청평면 청평리 98' / '… 매산로1가 12'. 도로명: '… 청평면 ○○로 12' 또는 '… 삼성로 129 (매탄동)'."""
    for addr, is_lot in ((lot, True), (road, False)):
        for pre, cd in sg_index:
            if not addr.startswith(pre):
                continue
            rest = addr[len(pre):]
            m = re.match(r'(\S+?[동읍면가])(?=\s|$)', rest) if is_lot else re.match(r'(\S+[읍면])(?=\s)', rest)
            if not m and not is_lot:
                m = re.search(r'\(([^,()]+?[동가])[,)]', rest)
            if m:
                return cd, m.group(1)
    return None, ''


def fetch_all(skip=()):
    """업종별 쪽 내려받기만 동시에(업종마다 호출 한도가 따로라 겹쳐도 한도 손해 없음). 집계는 licenses()가 캐시로 바로 끝낸다."""
    def one(svc):
        try:
            total = get(LOCAL.format(svc), pageNo=1, numOfRows=1, returnType='json')['response']['body']['totalCount']
        except NotRegistered:
            return
        def safe(p):
            try:
                lic_page(svc, p)
            except QuotaExceeded:
                raise
            except Exception:
                pass
        try:
            with ThreadPoolExecutor(4) as ex:
                list(ex.map(safe, pages_of(svc, total)))
        except QuotaExceeded:
            pass
        print(f'  {LICENSE_SVC[svc]} 내려받기 끝', flush=True)
    with ThreadPoolExecutor(len(LICENSE_SVC)) as ex:
        list(ex.map(one, [s for s in LICENSE_SVC if s not in skip]))


def licenses(only=()):
    regions = json.loads((CACHE / 'regions.json').read_text(encoding='utf-8'))['regions']
    sg_index = sorted(((f'{a} {g["name"]} ' if g['name'] != r['name'] else f'{a} ', cd)
                       for r in regions.values() for cd, g in r['signgu'].items() for a in SIDO_ALIAS.get(r['name'], [r['name']])),
                      key=lambda t: -len(t[0]))
    status, summary = {}, []
    prev = CACHE / 'lic_status.json'
    if only and prev.exists():                          # 일부 업종만 다시 집계할 때 나머지 업종 결과는 그대로 둔다
        old = json.loads(prev.read_text(encoding='utf-8'))
        labels = {LICENSE_SVC[s] for s in only if s in LICENSE_SVC}
        status = {k: v for k, v in old['status'].items() if k not in only}
        summary = [r for r in old['summary'] if r['업종'] not in labels]
    for svc, label in LICENSE_SVC.items():
        if only and svc not in only:
            continue
        try:
            total = get(LOCAL.format(svc), pageNo=1, numOfRows=1, returnType='json')['response']['body']['totalCount']
        except NotRegistered:
            status[svc] = '활용신청 필요'
            continue
        pages = pages_of(svc, total)
        def safe(p):                                    # 한 쪽이 계속 실패해도 전체를 멈추지 않는다 → 다음 실행 때 다시 받음
            try:
                lic_page(svc, p)
                return True
            except QuotaExceeded:
                raise
            except Exception:                          # 계속 실패·이상한 응답 형식(KeyError 등) 모두 이 쪽만 건너뜀
                return False
        try:
            failed = 0
            with ThreadPoolExecutor(4) as ex:
                for i, ok in enumerate(ex.map(safe, pages), 1):
                    failed += not ok
                    if i % 500 == 0:
                        print(f'  {label} {i}/{len(pages)}쪽 (실패 {failed})', flush=True)
            if failed:
                status[svc] = f'수집 중 (빠진 쪽 {failed})'
                print(f'{label}: {failed}쪽을 못 받았습니다. 다시 실행하면 빠진 쪽만 받습니다.', flush=True)
                continue
        except QuotaExceeded:
            got = len(list((LCACHE / MONTH / svc).glob('*.json')))
            status[svc] = f'수집 중 {got}/{len(pages)}쪽'           # 덜 받은 업종은 앱에 올리지 않는다 (내일 이어서)
            print(f'{label}: 오늘 한도 초과 ({got}/{len(pages)}쪽까지). 내일 다시 실행하면 이어서 받습니다.', flush=True)
            continue
        app, unplaced, n = Appender(LCACHE / 'lic' / svc), 0, 0
        for f in sorted((LCACHE / MONTH / svc).glob('*.json')):
            for x in json.loads(f.read_text(encoding='utf-8')):
                cd, bj = locate(x['lot'], x['road'], sg_index)
                if not cd:
                    unplaced += 1
                    continue
                app.add(f'{cd}_{bj}', {'name': x['name'], 'bz': x['bz'], 'open': x['open'], 'close': x['close'], 'addr': x['road'] or x['lot']})
                n += 1
        app.close()
        shutil.rmtree(OUT / 'lic' / svc, ignore_errors=True)
        per_sg = collections.Counter()
        for p in (LCACHE / 'lic' / svc).glob('*.jsonl'):
            cd, bj = p.stem.split('_', 1)
            dump(OUT / 'lic' / svc / cd / f'{bj}.json', aggregate(read_jsonl(p), svc))
            per_sg[cd] += 1
        summary += [{'업종': label, '시군구코드': cd, '법정동수': k} for cd, k in sorted(per_sg.items())]
        status[svc] = 'ok'
        dump(CACHE / 'lic_status.json', {'status': status, 'summary': summary})   # 업종마다 저장(중간에 한도 초과돼도 앞 업종은 남게)
        print(f'{label}: {n:,}건 배치, 주소 해석 못 함 {unplaced:,}건', flush=True)
    dump(CACHE / 'lic_status.json', {'status': status, 'summary': summary})


def holidays(year):
    try:
        j = get('https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo', solYear=year, numOfRows=100, _type='json')
    except NotRegistered:
        return None
    it = (j['response']['body']['items'] or {}).get('item', [])
    it = it if isinstance(it, list) else [it]
    return sorted(str(x['locdate']) for x in it if x.get('isHoliday') == 'Y')


TRADE = 'https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade'   # 국토교통부 상업업무용 부동산 매매 실거래가


def trade(months=12):
    """시군구별 최근 12개월 상가·사무실 매매 → data/trade/{시군구}.json. 활용신청 전이면 상태만 남기고 끝."""
    regions = json.loads((CACHE / 'regions.json').read_text(encoding='utf-8'))['regions']
    sgs = [cd for r in regions.values() for cd in r['signgu']]
    yms = [m.replace('-', '') for m in months_back(months)]
    try:
        get(TRADE, LAWD_CD=sgs[0], DEAL_YMD=yms[-1], pageNo=1, numOfRows=1)
    except NotRegistered:
        dump(CACHE / 'trade_status.json', {'status': '활용신청 필요'})
        print('상업업무용 실거래: 활용신청 필요')
        return
    f = lambda x, k: str(x.get(k) or '').strip()
    def one(sg):
        rows = []
        for ym in yms:
            page = 1
            while True:
                b = get(TRADE, LAWD_CD=sg, DEAL_YMD=ym, pageNo=page, numOfRows=1000)['response']['body']
                it = (b.get('items') or {}).get('item') or []
                for x in (it if isinstance(it, list) else [it]):
                    if f(x, 'cdealType'):                       # 해제된 거래는 뺀다
                        continue
                    rows.append({'d': f'{f(x, "dealYear")}-{int(x["dealMonth"]):02d}-{int(x["dealDay"]):02d}', 'dong': f(x, 'umdNm'),
                                 'type': f(x, 'buildingType'), 'use': f(x, 'buildingUse'), 'floor': f(x, 'floor'),
                                 'area': float(f(x, 'buildingAr') or 0), 'land': float(f(x, 'plottageAr') or 0),
                                 'built': f(x, 'buildYear'), 'price': int(f(x, 'dealAmount').replace(',', '') or 0)})   # 만원
                if page * 1000 >= int(b.get('totalCount') or 0):
                    break
                page += 1
        rows.sort(key=lambda r: r['d'], reverse=True)
        dump(OUT / 'trade' / f'{sg}.json', {'months': months_back(months), 'deals': rows})
        return len(rows)
    with ThreadPoolExecutor(4) as ex:
        n = sum(ex.map(one, sgs))
    dump(CACHE / 'trade_status.json', {'status': 'ok', 'month': MONTH, 'deals': n})
    print(f'상업업무용 실거래: 시군구 {len(sgs)}곳, {n:,}건')


def meta():
    today = dt.date.today()
    reg = json.loads((CACHE / 'regions.json').read_text(encoding='utf-8'))
    lic = json.loads((CACHE / 'lic_status.json').read_text(encoding='utf-8'))
    hol = {str(y): holidays(str(y)) for y in (today.year, today.year + 1)}
    tr = CACHE / 'trade_status.json'
    trade_st = json.loads(tr.read_text(encoding='utf-8')) if tr.exists() else {'status': '활용신청 필요'}
    b = reg.get('basis', '')
    dump(OUT / 'meta.json', {'updated': today.isoformat(), 'stores_basis': f'{b[:4]}-{b[4:]}' if b else '',
                             'regions': reg['regions'], 'license_services': LICENSE_SVC, 'license_status': lic['status'], 'holidays': hol, 'trade': trade_st,
                             'sources': ['소상공인시장진흥공단 상가(상권)정보', '행정안전부 지방행정 인허가 데이터'] + (['한국천문연구원 특일정보'] if any(hol.values()) else []) + (['국토교통부 상업업무용 부동산 실거래가'] if trade_st['status'] == 'ok' else [])})
    from openpyxl import Workbook                       # 검수용 엑셀 (저장소에는 올리지 않음)
    wb = Workbook()
    for i, (title, rows) in enumerate((('행정동별 점포수', json.loads((CACHE / 'store_summary.json').read_text(encoding='utf-8'))), ('시군구별 인허가', lic['summary']))):
        ws = wb.active if i == 0 else wb.create_sheet()
        ws.title = title
        cols = list(dict.fromkeys(k for r in rows for k in r))
        ws.append(cols)
        for r in rows:
            ws.append([r.get(c, 0) for c in cols])
    xl = DESK / f'사장님데이터_전국_{MONTH}.xlsx'
    wb.save(xl)
    print('엑셀', xl, '| 인허가', lic['status'], '| 공휴일', {y: (len(v) if v else '활용신청 필요') for y, v in hol.items()})


if __name__ == '__main__':
    step = sys.argv[1] if len(sys.argv) > 1 else 'all'
    zp = sys.argv[2] if len(sys.argv) > 2 else (max(RAW.glob('*.zip'), key=os.path.getmtime, default=None) if RAW.exists() else None)
    try:
        if step in ('stores', 'all'):
            stores(zp)
        if step == 'fetch':                            # python export.py fetch rest_cafes → 카페 빼고 나머지 업종 동시에
            fetch_all(sys.argv[2:])
        if step in ('lic', 'all'):
            licenses(sys.argv[2:] if step == 'lic' else ())                   # python export.py lic bakeries clinics → 그 업종만
        if step in ('trade', 'all'):
            trade()
        if step in ('meta', 'all'):
            meta()
    except QuotaExceeded as e:
        print(f'오늘 호출 한도 초과({e}). 내일 다시 실행하면 받은 곳은 건너뛰고 이어서 받습니다.')
        sys.exit(2)
