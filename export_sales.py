# -*- coding: utf-8 -*-
"""동네 매출 → data/sales/{행정동8자리}.json

  서울: 서울 열린데이터광장 상권분석서비스 — 추정매출(행정동) VwsmAdstrdSelngW + 점포(행정동) VwsmAdstrdStorW, 분기
        키: ../blog-writer_mcp/.env SEOUL_DATA_KEY
  python export_sales.py
행정동 코드는 앱(상가정보)과 같은 8자리. 최근 8개 분기만 싣는다.
"""
import collections
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parent / 'blog-writer_mcp' / '.env')
OUT = HERE / 'data' / 'sales'
KEEP_Q = 8
AGES = ['10', '20', '30', '40', '50', '60_ABOVE']
TIMES = ['00_06', '06_11', '11_14', '14_17', '17_21', '21_24']
DAYS = ['MON', 'TUES', 'WED', 'THUR', 'FRI', 'SAT', 'SUN']


def seoul(svc):
    """서울 OpenAPI 전체 행 (1회 최대 1,000행)."""
    key = os.environ['SEOUL_DATA_KEY']
    url = lambda a, b: f'http://openapi.seoul.go.kr:8088/{key}/json/{svc}/{a}/{b}/'

    def page(a):
        for wait in (2, 5, 15, 30, 0):
            try:
                j = requests.get(url(a, a + 999), timeout=60).json()[svc]
                return j.get('row', [])
            except (requests.RequestException, ValueError, KeyError):
                if not wait:
                    raise RuntimeError(f'{svc} {a}행 계속 실패')   # 주소에 키가 있어 그대로 남기지 않는다
                time.sleep(wait)
    total = requests.get(url(1, 1), timeout=60).json()[svc]['list_total_count']
    rows = []
    with ThreadPoolExecutor(4) as ex:
        for i, part in enumerate(ex.map(page, range(1, total + 1, 1000)), 1):
            rows += part
            if i % 50 == 0:
                print(f'  {svc} {len(rows):,}/{total:,}', flush=True)
    return rows


def main():
    sales, stores = seoul('VwsmAdstrdSelngW'), seoul('VwsmAdstrdStorW')
    quarters = sorted({r['STDR_YYQU_CD'] for r in sales})[-KEEP_Q:]
    qset = set(quarters)
    by = collections.defaultdict(lambda: {'ind': {}})
    for r in sales:
        q = r['STDR_YYQU_CD']
        if q not in qset:
            continue
        d = by[r['ADSTRD_CD']]
        d['name'] = r['ADSTRD_CD_NM']
        ind = d['ind'].setdefault(r['SVC_INDUTY_CD_NM'], {'q': {}})
        x = ind['q'].setdefault(q, {})
        x['amt'] = round(r['THSMON_SELNG_AMT'] or 0)
        x['cnt'] = round(r['THSMON_SELNG_CO'] or 0)
        if q == quarters[-1]:                              # 최신 분기만 세부 분포
            ind['days'] = [round(r.get(f'{k}_SELNG_AMT') or 0) for k in DAYS]
            ind['times'] = [round(r.get(f'TMZON_{k}_SELNG_AMT') or 0) for k in TIMES]
            ind['ages'] = [round(r.get(f'AGRDE_{k}_SELNG_AMT') or 0) for k in AGES]
            ind['sex'] = [round(r.get('ML_SELNG_AMT') or 0), round(r.get('FML_SELNG_AMT') or 0)]
    for r in stores:
        q = r['STDR_YYQU_CD']
        if q not in qset or r['ADSTRD_CD'] not in by:
            continue
        ind = by[r['ADSTRD_CD']]['ind'].setdefault(r['SVC_INDUTY_CD_NM'], {'q': {}})
        x = ind['q'].setdefault(q, {})
        x['stores'] = round(r.get('SIMILR_INDUTY_STOR_CO') or r.get('STOR_CO') or 0)
        x['open'] = r.get('OPBIZ_RT') or 0
        x['close'] = r.get('CLSBIZ_RT') or 0
    OUT.mkdir(parents=True, exist_ok=True)
    for cd, d in by.items():
        (OUT / f'{cd}.json').write_text(json.dumps({'source': '서울시 상권분석서비스(추정매출·점포)', 'unit': '분기', 'quarters': quarters, **d},
                                                    ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'서울 매출: {len(by)}개 행정동, 분기 {quarters[0]}~{quarters[-1]}', flush=True)


if __name__ == '__main__':
    main()
