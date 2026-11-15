# -*- coding: utf-8 -*-
"""生成 articles.js —— 短文，逐字预标拼音（已人工校对多音字）"""
import io
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', 'data'))

PINYIN_URL = 'https://raw.githubusercontent.com/mozillazg/pinyin-data/master/pinyin.txt'

TONE_MAP = {
    'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
    'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
    'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e', 'ê': 'e',
    'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
    'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
    'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v', 'ü': 'v',
    'ń': 'n', 'ň': 'n', 'ǹ': 'n', 'ḿ': 'm', 'm̀': 'm',
}

ARTICLES = [
    ("早晨的街", "早上六点，天刚亮，楼下的早点铺已经开了门。热气从蒸笼里冒出来，白茫茫的一片。我要了一碗豆浆和两个包子，坐在靠窗的位置慢慢吃。街上的人还不多，只有几个骑车上班的人匆匆经过。"),
    ("周末购物", "周末的超市里人很多，我推着车在货架之间走。先买了米和油，又在水果区挑了几个苹果。结账的时候排了很久的队，收银员动作很快，一会儿就轮到我了。"),
    ("下雨天", "今天的天气不太好，从早上开始就下起了小雨。风也有点大，树叶被吹得沙沙响。出门的时候我忘了带伞，只好站在门口等雨小一点。"),
    ("读书的习惯", "我每天都会花一个小时读书。有时候读小说，有时候看一些有用的文章。读书能让人的心静下来，也能学到很多东西。坚持一段时间以后，我发现自己的变化很大。"),
    ("做一顿饭", "晚上我自己做饭。先把米洗干净放进锅里，再把菜切好。锅里放一点油，等油热了就把菜倒进去，加点盐，炒几分钟就可以出锅了。自己做的饭虽然简单，但是吃得很舒服。"),
    ("晚饭后散步", "晚饭后我习惯出去走走。沿着河边的小路一直往前，走二十分钟左右就到一个公园。那里晚上很安静，能听见虫子的叫声。走完一圈回来，身上微微出汗，晚上睡得很好。"),
    ("整理电脑", "我的电脑用了五年，最近开机越来越慢。今天我把不用的软件都删掉，又清理了一下硬盘，速度快了不少。以后要记得定期整理，不然东西越堆越多，用起来就麻烦。"),
    ("老朋友", "老朋友从外地回来，我们约在一家小饭馆见面。几年没见，他瘦了一些，说话还是那样。我们聊了很久，从上学的时候一直聊到现在的工作。分开的时候，天已经黑了。"),
]

# 多音字人工覆盖：(文章序号, 字位置, 正确拼音)
OVERRIDE = {}

# 标点白名单，不参与打字判定
PUNCT = '，。！？、；：""''（）《》…— '


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
    src = os.path.join(HERE, 'pinyin.txt')
    if not (os.path.exists(src) and os.path.getsize(src) > 1024):
        print('下载 pinyin.txt ...')
        urllib.request.urlretrieve(PINYIN_URL, src)
    with io.open(src, encoding='utf-8') as f:
        for line in f:
            if line.startswith('#'):
                continue
            m = pat.match(line)
            if not m:
                continue
            table[chr(int(m.group(1), 16))] = [p.strip() for p in m.group(2).split(',') if p.strip()]
    return table


def main():
    table = load_pinyin()
    out = []
    for ai, (title, text) in enumerate(ARTICLES):
        tokens = []
        missing = []
        for i, ch in enumerate(text):
            if ch in PUNCT:
                tokens.append({"c": ch, "p": ""})
                continue
            py = OVERRIDE.get((ai, i))
            if py is None:
                pys = table.get(ch)
                if not pys:
                    missing.append(ch)
                    continue
                py = strip_tone(pys[0])
            if not py:
                missing.append(ch)
                continue
            tokens.append({"c": ch, "p": py})
        if missing:
            print('警告 [%s] 缺拼音: %s' % (title, ''.join(missing)))
        out.append({"t": title, "s": tokens})
        print('%-8s %d 字' % (title, sum(1 for x in tokens if x['p'])))

    os.makedirs(OUT, exist_ok=True)
    parts = []
    for a in out:
        body = ','.join('["%s","%s"]' % (x['c'], x['p']) for x in a['s'])
        parts.append('{"t":"%s","s":[%s]}' % (a['t'], body))
    js = '/* 自动生成 · 请勿手改 · 源: _build/gen_articles.py */\nwindow.DAZI_ARTICLES=[' + ','.join(parts) + '];\n'
    p = os.path.join(OUT, 'articles.js')
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    print('articles.js %.1f KB' % (os.path.getsize(p) / 1024.0))


if __name__ == '__main__':
    main()
