# -*- coding: utf-8 -*-
"""매일 새벽 작업 스케줄러가 실행 (SajangDataDaily). 바뀐 게 있을 때만 배포한다.

1. 상가정보 전국 파일이 포털에 새로 올라왔으면(분기) 내려받아 점포 데이터를 다시 만든다.
2. 인허가 API를 이어받는다(받은 쪽은 건너뜀, 하루 한도에 걸리면 다음 날 이어서).
3. 다 받은 업종이 늘었거나 점포 데이터가 바뀌었으면 meta 갱신 + gh-pages 배포.
로그: sajang-data/auto_update.log
"""
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

import requests

HERE = Path(__file__).parent
LOG = HERE / 'auto_update.log'
RAW = Path.home() / 'Downloads' / '상가정보_원본'
STATUS = HERE / '.cache' / 'lic_status.json'
PY = sys.executable


def log(msg):
    line = f'{dt.datetime.now():%Y-%m-%d %H:%M} {msg}'
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')
    print(line, flush=True)


def run(*args):
    r = subprocess.run([PY, '-u', *args], cwd=HERE, capture_output=True, text=True, encoding='utf-8', errors='replace')
    tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
    log(f'{" ".join(args)} → exit {r.returncode} | ' + ' / '.join(tail))
    return r.returncode


def new_store_file():
    """포털의 상가정보 파일 수정일이 내려받은 것보다 새로우면 받는다. 받았으면 True."""
    s = requests.Session()
    s.headers['User-Agent'] = 'Mozilla/5.0'
    ref = 'https://www.data.go.kr/data/15083033/fileData.do'
    page = s.get(ref, timeout=60).text
    pk = re.search(r"fn_fileDataDown\('15083033',\s*'([^']+)'", page).group(1)
    j = json.loads(s.post('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do', headers={'Referer': ref}, timeout=60,
                          data=dict(publicDataDetailPk=pk, publicDataPk='15083033', atchFileId='', fileDetailSn='1', publicDataTyCode='PR0051')).text)
    info = j['dataSetFileDetailInfo']
    name = (info.get('dataNm') or info.get('publicDataSj') or '상가정보').strip()
    target = RAW / f'{name}.zip'
    if target.exists():
        return False
    chk = s.post('https://www.data.go.kr/cmm/cmm/check-limit.json', data=dict(atchFileId=j['atchFileId'], fileDetailSn=j['fileDetailSn']),
                 headers={'Referer': ref}, timeout=60)
    if chk.status_code != 200 or chk.json().get('needCaptcha'):
        log('상가정보 새 파일이 있으나 캡차 요구 — 수동 다운로드 필요')
        return False
    RAW.mkdir(parents=True, exist_ok=True)
    with s.get('https://www.data.go.kr/cmm/cmm/fileDownload.do', stream=True, timeout=1800, headers={'Referer': ref},
               params=dict(atchFileId=j['atchFileId'], fileDetailSn=j['fileDetailSn'], dataNm=name)) as d, open(target.with_suffix('.part'), 'wb') as f:
        for ch in d.iter_content(1 << 20):
            f.write(ch)
    target.with_suffix('.part').replace(target)
    log(f'상가정보 새 파일 받음: {target.name}')
    return True


def ok_set():
    try:
        return {k for k, v in json.loads(STATUS.read_text(encoding='utf-8'))['status'].items() if v == 'ok'}
    except (OSError, ValueError, KeyError):
        return set()


def busy():
    """export.py 수집이 이미 돌고 있으면 겹치지 않게 건너뛴다.
    로그 시각으로 판단하면 PC 절전 뒤 멈춘 수집과 겹친다(2026-10-11 두 개가 동시에 돎) → 실제 프로세스를 본다."""
    ps = "Get-CimInstance Win32_Process -Filter \"name='python.exe'\" | % CommandLine"
    out = subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True, text=True, errors='replace').stdout
    return 'export.py' in out


def main():
    if busy():
        log('다른 수집이 진행 중 — 오늘은 건너뜀')
        return
    changed = False
    try:
        if new_store_file() and run('export.py', 'stores') == 0:
            changed = True
    except Exception as e:                            # 포털 화면이 바뀌어도 인허가 수집은 계속
        log(f'상가정보 확인 실패: {e}')
    try:                                              # 서울 추정매출: 서울시 자료 건수가 바뀌었을 때(새 분기)만 다시 받는다
        import os
        from dotenv import load_dotenv
        load_dotenv(HERE.parent / 'blog-writer_mcp' / '.env')
        cnt = requests.get(f"http://openapi.seoul.go.kr:8088/{os.environ['SEOUL_DATA_KEY']}/json/VwsmAdstrdSelngW/1/1/", timeout=60).json()['VwsmAdstrdSelngW']['list_total_count']
        mark = HERE / 'data' / 'sales' / '_seoul_count.txt'
        if not mark.exists() or mark.read_text().strip() != str(cnt):
            if run('export_sales.py') == 0:
                mark.write_text(str(cnt))
                changed = True
    except Exception as e:
        log(f'서울 매출 확인 실패: {type(e).__name__}')   # 주소에 키가 있어 메시지 원문은 남기지 않는다
    try:                                              # 상가·사무실 실거래: 한 달에 한 번 (활용신청 전이면 export.py가 상태만 남김)
        st = HERE / '.cache' / 'trade_status.json'
        old = json.loads(st.read_text(encoding='utf-8')) if st.exists() else {}
        if old.get('month') != dt.date.today().strftime('%Y-%m') and run('export.py', 'trade') == 0:
            new = json.loads(st.read_text(encoding='utf-8')) if st.exists() else {}
            changed = changed or new.get('status') == 'ok'
    except Exception as e:
        log(f'실거래 확인 실패: {type(e).__name__}')
    before = ok_set()
    run('export.py', 'lic')
    after = ok_set()
    if after - before:
        log(f'새로 완료된 업종: {sorted(after - before)}')
        changed = True
    if changed:
        if run('export.py', 'meta') == 0:
            run('publish.py')
    else:
        log('변경 없음 — 배포 생략')


if __name__ == '__main__':
    main()
