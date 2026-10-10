# -*- coding: utf-8 -*-
"""매달 1회: 공공 API → data/*.json (앱이 읽는 파일) + 바탕화면 검수용 엑셀.

  python export.py            # 수원시 4개 구
  그다음  git add data && git commit -m "2026-10 데이터" && git push

키는 이 저장소에 두지 않는다. ../blog-writer_mcp/.env 의 DATA_GO_KR_KEY (또는 환경변수)를 읽는다.
방문자는 API를 호출하지 않고 여기서 만든 파일만 읽는다.
"""
import collections
import datetime as dt
import json
import os
import re
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / 'blog-writer_mcp' / '.env')
KEY = os.environ['DATA_GO_KR_KEY']
OUT = HERE / 'data'
DESK = Path.home() / 'OneDrive' / '바탕 화면'
SIGNGU = {'41111': '수원시 장안구', '41113': '수원시 권선구', '41115': '수원시 팔달구', '41117': '수원시 영통구'}
SBIZ = 'https://apis.data.go.kr/B553077/api/open/sdsc2'
LOCAL = 'https://apis.data.go.kr/1741000/{}/info'
LICENSE_SVC = {'rest_cafes': '휴게음식점(카페 등)', 'general_restaurants': '일반음식점', 'beauty_salons': '미용업'}


class NotRegistered(Exception):
    pass


def get(url, **params):
    for wait in (2, 5, 15, 30, 0):                     # 공공 API는 503(혼잡)을 가끔 낸다 → 쉬었다 재시도
        try:
            r = requests.get(url, params={'serviceKey': KEY, **params}, timeout=60)
            if 'SERVICE_KEY_IS_NOT_REGISTERED' in r.text:
                raise NotRegistered(url)
            if r.status_code < 500:
                r.raise_for_status()
                return r.json()
        except requests.ConnectionError:
            pass
        if not wait:
            raise RuntimeError(f'{url.split("?")[0]} 계속 실패 (HTTP {r.status_code})')   # 주소에 키가 섞여 로그에 남지 않게
        time.sleep(wait)


def dongs(signgu):
    return [(x['adongCd'], x['adongNm']) for x in get(SBIZ + '/baroApi', resId='dong', catId='admi', signguCd=signgu, type='json')['body']['items']]


def stores(adong):
    rows, page = [], 1
    while True:
        b = get(SBIZ + '/storeListInDong', divId='adongCd', key=adong, numOfRows=1000, pageNo=page, type='json')['body']
        rows += b.get('items', [])
        if page * 1000 >= b['totalCount']:
            break
        page += 1
    return rows


def bjdong_of(lot, road):
    """인허가 주소에서 법정동: 지번 '경기도 수원시 영통구 매탄동 123' → 매탄동, 없으면 도로명 괄호 '(매탄동, ...)'."""
    m = re.search(r'수원시 \S+구 (\S+?[동가로])\s', lot + ' ')
    if m:
        return m.group(1)
    m = re.search(r'\(([^,()]+?[동가로])[,)]', road)
    return m.group(1) if m else ''


def licenses(svc, signgu_name):
    seen = {}
    for field in ('LOTNO_ADDR', 'ROAD_NM_ADDR'):
        page = 1
        while True:
            b = get(LOCAL.format(svc), **{'pageNo': page, 'numOfRows': 100, 'returnType': 'json', f'cond[{field}::LIKE]': signgu_name})['response']['body']
            for x in (b['items']['item'] if b['totalCount'] else []):
                seen[x['MNG_NO']] = x
            if page * 100 >= b['totalCount']:                # 인허가 API는 한 번에 100건까지만 준다
                break
            page += 1
    return [{'name': x['BPLC_NM'], 'bz': x['SNTTN_BZSTAT_NM'] or x['BZSTAT_SE_NM'], 'open': x['LCPMT_YMD'], 'close': x['CLSBIZ_YMD'],
             'addr': x['ROAD_NM_ADDR'] or x['LOTNO_ADDR'], 'bj': bjdong_of(x['LOTNO_ADDR'], x['ROAD_NM_ADDR'])} for x in seen.values()]


def holidays(year):
    try:
        j = get('https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo', solYear=year, numOfRows=100, _type='json')
    except NotRegistered:
        return None
    it = (j['response']['body']['items'] or {}).get('item', [])
    it = it if isinstance(it, list) else [it]
    return sorted(str(x['locdate']) for x in it if x.get('isHoliday') == 'Y')


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def main():
    today = dt.date.today()
    regions, summary, lic_summary, status = {}, [], [], {}
    for sg, sg_name in SIGNGU.items():
        regions[sg] = {'name': sg_name, 'dongs': []}
        for cd, nm in dongs(sg):
            rows = stores(cd)
            # 행정동 ↔ 법정동: 이 행정동 점포들의 법정동 분포 (5% 이상만)
            lds = collections.Counter(x['ldongNm'] for x in rows if x.get('ldongNm'))
            ld = [d for d, n in lds.most_common() if n >= max(1, len(rows) * .05)]
            keep = [{'n': x['bizesNm'], 'b': x.get('brchNm') or '', 'l': x['indsLclsNm'], 'm': x['indsMclsNm'], 's': x['indsSclsNm'],
                     'a': x['rdnmAdr'], 'f': x.get('flrNo') or ''} for x in rows]
            dump(OUT / 'dong' / f'{cd}.json', {'adong': nm, 'signgu': sg_name, 'ldongs': ld, 'stores': keep})
            regions[sg]['dongs'].append([cd, nm])
            c = collections.Counter(x['indsLclsNm'] for x in rows)
            summary.append({'구': sg_name, '행정동': nm, '법정동': ', '.join(ld), '전체': len(rows), **c})
            print(sg_name, nm, len(rows))
        for svc, label in LICENSE_SVC.items():
            try:
                lic = licenses(svc, sg_name)
            except NotRegistered:
                status[svc] = '활용신청 필요'
                continue
            status[svc] = 'ok'
            by = collections.defaultdict(list)
            for x in lic:
                by[x['bj']].append({k: v for k, v in x.items() if k != 'bj'})
            for bj, rs in by.items():
                if bj:
                    dump(OUT / 'lic' / svc / sg / f'{bj}.json', rs)
                    lic_summary.append({'구': sg_name, '법정동': bj, '업종': label, '전체이력': len(rs), '영업중': sum(1 for r in rs if not r['close'])})
            print(sg_name, label, len(lic))

    hol = {str(y): holidays(str(y)) for y in (today.year, today.year + 1)}
    dump(OUT / 'meta.json', {'updated': today.isoformat(), 'regions': regions, 'license_services': LICENSE_SVC, 'license_status': status, 'holidays': hol,
                             'sources': ['소상공인시장진흥공단 상가(상권)정보', '행정안전부 지방행정 인허가 데이터'] + (['한국천문연구원 특일정보'] if any(hol.values()) else [])})

    # 검수용 엑셀 (저장소에는 올리지 않음)
    from openpyxl import Workbook
    wb = Workbook()
    for title, rows in (('동별 점포수', summary), ('법정동별 인허가', lic_summary)):
        ws = wb.active if title == '동별 점포수' else wb.create_sheet(title)
        ws.title = title
        cols = list(dict.fromkeys(k for r in rows for k in r))
        ws.append(cols)
        for r in rows:
            ws.append([r.get(c, 0) for c in cols])
    xl = DESK / f'사장님데이터_수원_{today:%Y-%m}.xlsx'
    wb.save(xl)
    print('엑셀', xl)
    print('인허가 상태', status, '공휴일', {y: (len(v) if v else '활용신청 필요') for y, v in hol.items()})


if __name__ == '__main__':
    main()
