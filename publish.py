# -*- coding: utf-8 -*-
"""앱(index.html, tax.js) + data/ 를 gh-pages 브랜치에 '최신본 하나'로 올린다.

데이터가 수백 MB라 매달 기록을 쌓으면 GitHub 권장 용량(1GB)을 금방 넘는다.
그래서 gh-pages는 매번 기록 없는 새 커밋 하나로 덮어쓴다(force push). 코드 기록은 main 브랜치에 그대로 남는다.
  python publish.py
"""
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import requests

HERE = Path(__file__).parent
SITE = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'sajang-data-cache' / 'site'   # gh-pages 작업 폴더 (OneDrive 밖: 동기화가 파일을 잡지 않게)
FILES = ['index.html', 'tax.js', 'tools.js', 'wht_table.js', 'widget_calc.png']   # 2026-10-11 계산기만 운영 → data/(상권·인허가 570MB)는 올리지 않음. 탭을 되살리면 'data' 다시 추가


def git(*a, cwd=SITE):
    subprocess.run(['git', *a], cwd=cwd, check=True)


def preflight():
    """화면 스크립트 문법 + 세금 계산 테스트. 하나라도 실패하면 배포하지 않는다(2026-10-10 깨진 화면이 10분 공개된 뒤 추가)."""
    syntax = "const h=require('fs').readFileSync('index.html','utf8');for(const b of h.split('<script>').slice(1))new Function(b.split('</script>')[0]);"
    for cmd in (['node', '-e', syntax], ['node', 'tax_test.js']):
        r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode != 0:
            sys.exit('배포 중단 — 검사 실패: ' + ' '.join(cmd[:2]) + '\n' + (r.stderr or r.stdout)[-600:])


def main():
    preflight()
    remote = subprocess.run(['git', 'remote', 'get-url', 'origin'], cwd=HERE, capture_output=True, text=True, check=True).stdout.strip()
    if SITE.exists():                                   # git 객체 파일은 읽기 전용이라 권한을 풀고 지운다
        shutil.rmtree(SITE, onexc=lambda f, p, e: (os.chmod(p, stat.S_IWRITE), f(p)))
    SITE.mkdir(parents=True)
    for f in FILES:
        src = HERE / f
        (shutil.copytree if src.is_dir() else shutil.copy2)(src, SITE / f)
    (SITE / '.nojekyll').write_text('')                 # GitHub Pages가 파일을 가공하지 않고 그대로 내보내게
    git('init', '-q', '-b', 'gh-pages')
    git('config', 'user.name', 'tlpok2791')
    git('config', 'user.email', 'tlpok2791@users.noreply.github.com')
    git('config', 'core.autocrlf', 'false')
    git('add', '-A')
    git('commit', '-q', '-m', '사이트 최신본')
    git('push', '-f', remote, 'gh-pages')
    # Pages는 소스 전환 직후 등에 새 빌드를 안 만들 때가 있다(2026-10-10 10분 넘게 옛 화면) → 빌드를 직접 요청
    tok = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True).stdout
    tok = next((l[9:] for l in tok.splitlines() if l.startswith('password=')), '')
    repo = remote.removesuffix('.git').split('github.com/')[1]
    r = requests.post(f'https://api.github.com/repos/{repo}/pages/builds', headers={'Authorization': f'Bearer {tok}'}, timeout=30)
    print('gh-pages 올림 →', remote, '| 빌드 요청', r.status_code)


if __name__ == '__main__':
    sys.exit(main())
