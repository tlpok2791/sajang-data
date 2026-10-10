# -*- coding: utf-8 -*-
"""앱(index.html, tax.js) + data/ 를 gh-pages 브랜치에 '최신본 하나'로 올린다.

데이터가 수백 MB라 매달 기록을 쌓으면 GitHub 권장 용량(1GB)을 금방 넘는다.
그래서 gh-pages는 매번 기록 없는 새 커밋 하나로 덮어쓴다(force push). 코드 기록은 main 브랜치에 그대로 남는다.
  python publish.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
SITE = HERE / '.cache' / 'site'                       # gh-pages 작업 폴더 (git 제외)
FILES = ['index.html', 'tax.js', 'data']


def git(*a, cwd=SITE):
    subprocess.run(['git', *a], cwd=cwd, check=True)


def main():
    assert (HERE / 'data' / 'meta.json').exists(), 'data/meta.json 이 없습니다. export.py 를 먼저 실행하세요.'
    remote = subprocess.run(['git', 'remote', 'get-url', 'origin'], cwd=HERE, capture_output=True, text=True, check=True).stdout.strip()
    shutil.rmtree(SITE, ignore_errors=True)
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
    print('gh-pages 올림 →', remote)


if __name__ == '__main__':
    sys.exit(main())
