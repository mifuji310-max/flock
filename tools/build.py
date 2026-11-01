"""FLOCK ビルドスクリプト

src/shell.html + src/engine.js + src/app.js を1つのHTMLにまとめ、次の2つを書き出す。
  - index.html                 … GitHub Pages で公開する最新版
  - releases/flock_v{版数}.html … 版ごとの保存用（既存の版は上書きしない）

使い方:
  python3 tools/build.py          # VERSION ファイルの版数でビルド
  python3 tools/build.py 0.13     # 版数を指定（VERSION も更新する）
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'


def wrap(content):
    """単独のページとして開けるよう、文書の骨組みを付ける。
    shell.html 冒頭の <title>・<meta>・<link>・<style> は <head> へ、<canvas> 以降は <body> へ入れる。"""
    i = content.index('<canvas')
    head, body = content[:i], content[i:]
    return ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<meta name="theme-color" content="#03101b">\n'
            '<style>html,body{margin:0}</style>\n' + head + '</head>\n<body>\n' + body + '</body>\n</html>\n')


def main():
    version_file = ROOT / 'VERSION'
    if len(sys.argv) > 1:
        version = sys.argv[1].strip()
        version_file.write_text(version + '\n', encoding='utf-8')
        pkg = ROOT / 'package.json'   # package.json の version も合わせる（0.13 → 0.13.0）
        if pkg.exists():
            import json, re
            text = pkg.read_text(encoding='utf-8')
            text = re.sub(r'"version": "[^"]*"', '"version": "' + version + '.0"', text, count=1)
            pkg.write_text(text, encoding='utf-8')
    else:
        version = version_file.read_text(encoding='utf-8').strip()

    src = ROOT / 'src'
    shell = (src / 'shell.html').read_text(encoding='utf-8')
    engine = (src / 'engine.js').read_text(encoding='utf-8')
    app = (src / 'app.js').read_text(encoding='utf-8')
    if f'FLOCK v{version}</b>' not in shell:
        print(f'警告: src/shell.html の設定画面の版数表示が v{version} になっていません（.ver の段落を更新してください）')

    page = wrap(shell + '\n<script src="' + THREE_CDN + '"></script>\n'
                '<script>\n' + engine + '\n</script>\n<script>\n' + app + '\n</script>\n')

    (ROOT / 'index.html').write_text(page, encoding='utf-8', newline='\n')   # Windows でも改行は LF
    release = ROOT / 'releases' / f'flock_v{version}.html'
    if release.exists():
        print(f'{release.name} は既にあるため上書きしません（版数を上げてください）')
    else:
        release.write_text(page, encoding='utf-8', newline='\n')
        print('書き出し:', release.relative_to(ROOT))
    print('書き出し: index.html', f'({len(page):,} bytes, v{version})')


if __name__ == '__main__':
    main()
