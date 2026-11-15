# -*- coding: utf-8 -*-
"""
生成打字网词库
  chars.js     GB2312 一级汉字 3755 个，按拼音音节分组
  words.js     高频双字词
  articles.js  短文（手写）
原始数据：
  pinyin.txt     mozillazg/pinyin-data (Unihan)
  jieba_dict.txt fxsjy/jieba 词频表
"""
import io
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', 'data'))

PINYIN_URL = 'https://raw.githubusercontent.com/mozillazg/pinyin-data/master/pinyin.txt'
JIEBA_URL = 'https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt'


def ensure(url, name):
    """原始数据不存在就从上游拉一份，避免仓库里塞大文件"""
    p = os.path.join(HERE, name)
    if os.path.exists(p) and os.path.getsize(p) > 1024:
        return p
    print('下载 %s ...' % name)
    urllib.request.urlretrieve(url, p)
    print('  %.1f KB' % (os.path.getsize(p) / 1024.0))
    return p

# ---------- 声调 -> 无声调 ----------
TONE_MAP = {
    'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
    'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
    'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e', 'ê': 'e',
    'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
    'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
    'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v', 'ü': 'v',
    'ń': 'n', 'ň': 'n', 'ǹ': 'n', 'ḿ': 'm', 'm̀': 'm',
}


def strip_tone(py):
    out = []
    for ch in py:
        if ch in TONE_MAP:
            out.append(TONE_MAP[ch])
        elif ch.isalpha() or ch.isdigit():
            out.append(ch.lower())
    return ''.join(out)


# ---------- 读拼音表 ----------
def load_pinyin():
    table = {}
    pat = re.compile(r'^U\+([0-9A-Fa-f]{4,6}):\s*([^#]+)')
    src = ensure(PINYIN_URL, 'pinyin.txt')
    with io.open(src, encoding='utf-8') as f:
        for line in f:
            if line.startswith('#'):
                continue
            m = pat.match(line)
            if not m:
                continue
            code = int(m.group(1), 16)
            ch = chr(code)
            pys = [p.strip() for p in m.group(2).split(',') if p.strip()]
            table[ch] = pys
    return table


# ---------- GB2312 一级汉字 3755 ----------
def gb2312_level1():
    chars = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes([hi, lo]).decode('gb2312')
            except UnicodeDecodeError:
                continue
            chars.append(ch)
    return chars


def build_chars(py_table):
    raw = gb2312_level1()
    items = []
    missing = []
    for ch in raw:
        pys = py_table.get(ch)
        if not pys:
            missing.append(ch)
            continue
        py = strip_tone(pys[0])
        if not py or not py.isalpha():
            missing.append(ch)
            continue
        items.append({'c': ch, 'p': py})
    items.sort(key=lambda x: (x['p'], x['c']))
    return items, missing


# ---------- 高频双字词 ----------
def build_words(py_table, limit=3000):
    cand = []
    src = ensure(JIEBA_URL, 'jieba_dict.txt')
    with io.open(src, encoding='utf-8') as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            word, freq = parts[0], parts[1]
            if len(word) != 2:
                continue
            if not word.isalpha():
                # 中文汉字 isalpha() 为 True，这里排除夹杂字母/符号的
                if not all('\u4e00' <= c <= '\u9fff' for c in word):
                    continue
            if not all('\u4e00' <= c <= '\u9fff' for c in word):
                continue
            try:
                freq = int(freq)
            except ValueError:
                continue
            cand.append((freq, word))

    cand.sort(reverse=True)
    seen = set()
    words = []
    for freq, word in cand:
        if word in seen:
            continue
        chars = []
        ok = True
        for ch in word:
            pys = py_table.get(ch)
            if not pys:
                ok = False
                break
            py = strip_tone(pys[0])
            if not py or not py.isalpha():
                ok = False
                break
            chars.append({'c': ch, 'p': py})
        if not ok:
            continue
        seen.add(word)
        words.append(chars)
        if len(words) >= limit:
            break
    return words


# ---------- 输出 ----------
def js_array_chars(items):
    return '[' + ','.join('["%s","%s"]' % (it['c'], it['p']) for it in items) + ']'


def js_array_words(words):
    parts = []
    for w in words:
        parts.append('[' + ','.join('["%s","%s"]' % (ch['c'], ch['p']) for ch in w) + ']')
    return '[' + ','.join(parts) + ']'


HEADER = '/* 自动生成 · 请勿手改 · 源: _build/gen.py */\n'


def main():
    os.makedirs(OUT, exist_ok=True)
    py_table = load_pinyin()
    print('拼音表:', len(py_table), '字')

    chars, missing = build_chars(py_table)
    print('一级汉字:', len(chars), '缺拼音:', len(missing), ''.join(missing[:20]))

    with io.open(os.path.join(OUT, 'chars.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(HEADER)
        f.write('window.DAZI_CHARS=' + js_array_chars(chars) + ';\n')

    words = build_words(py_table)
    print('双字词:', len(words))
    with io.open(os.path.join(OUT, 'words.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(HEADER)
        f.write('window.DAZI_WORDS=' + js_array_words(words) + ';\n')

    for name in ('chars.js', 'words.js'):
        p = os.path.join(OUT, name)
        print(name, '%.1f KB' % (os.path.getsize(p) / 1024.0))


if __name__ == '__main__':
    main()
