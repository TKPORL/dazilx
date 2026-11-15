# -*- coding: utf-8 -*-
"""生成 idioms.js —— 常用四字成语，逐字标拼音

原始数据：
  idiom.json      chinese-xinhua 成语库（30895 条）
  jieba_dict.txt  fxsjy/jieba 词频表（用于筛掉生僻成语）
  pinyin.txt      mozillazg/pinyin-data
"""
import io
import json
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', 'data'))

IDIOM_URL = 'https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/idiom.json'
JIEBA_URL = 'https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt'
PINYIN_URL = 'https://raw.githubusercontent.com/mozillazg/pinyin-data/master/pinyin.txt'

LIMIT = 3000

TONE_MAP = {
    'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
    'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
    'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e', 'ê': 'e',
    'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
    'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
    'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v', 'ü': 'v',
    'ń': 'n', 'ň': 'n', 'ǹ': 'n', 'ḿ': 'm', 'm̀': 'm',
}


def ensure(url, name):
    p = os.path.join(HERE, name)
    if os.path.exists(p) and os.path.getsize(p) > 1024:
        return p
    print('下载 %s ...' % name)
    urllib.request.urlretrieve(url, p)
    return p


def strip_tone(py):
    out = []
    for ch in py:
        if ch in TONE_MAP:
            out.append(TONE_MAP[ch])
        elif ch.isalpha():
            out.append(ch.lower())
    return ''.join(out)


def load_pinyin():
    table = {}
    pat = re.compile(r'^U\+([0-9A-Fa-f]{4,6}):\s*([^#]+)')
    with io.open(ensure(PINYIN_URL, 'pinyin.txt'), encoding='utf-8') as f:
        for line in f:
            if line.startswith('#'):
                continue
            m = pat.match(line)
            if m:
                table[chr(int(m.group(1), 16))] = [p.strip() for p in m.group(2).split(',') if p.strip()]
    return table


def load_freq():
    freq = {}
    with io.open(ensure(JIEBA_URL, 'jieba_dict.txt'), encoding='utf-8') as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                freq[parts[0]] = int(parts[1])
            except ValueError:
                continue
    return freq


def main():
    py = load_pinyin()
    freq = load_freq()
    data = json.load(io.open(ensure(IDIOM_URL, 'idiom.json'), encoding='utf-8'))

    cand = []
    for x in data:
        w = x.get('word', '')
        if len(w) != 4:
            continue
        if not all('\u4e00' <= c <= '\u9fff' for c in w):
            continue
        f = freq.get(w, 0)
        if f <= 0:
            continue          # 词频表里没有 = 生僻，丢掉
        cand.append((f, w))

    cand.sort(reverse=True)
    print('词频表命中的四字成语:', len(cand))

    out = []
    seen = set()
    for f, w in cand:
        if w in seen:
            continue
        chars = []
        ok = True
        for ch in w:
            pys = py.get(ch)
            if not pys:
                ok = False
                break
            p = strip_tone(pys[0])
            if not p or not p.isalpha():
                ok = False
                break
            chars.append([ch, p])
        if not ok:
            continue
        seen.add(w)
        out.append(chars)
        if len(out) >= LIMIT:
            break

    print('输出成语:', len(out))
    print('样例:', ' '.join(''.join(c[0] for c in it) for it in out[:12]))

    body = ','.join('[' + ','.join('["%s","%s"]' % (c[0], c[1]) for c in it) + ']' for it in out)
    js = '/* 自动生成 · 请勿手改 · 源: _build/gen_idioms.py */\nwindow.DAZI_IDIOMS=[' + body + '];\n'
    p = os.path.join(OUT, 'idioms.js')
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    print('idioms.js %.1f KB' % (os.path.getsize(p) / 1024.0))


if __name__ == '__main__':
    main()
