/* 打字网 · 练习引擎
 * 数据源：data/chars.js · words.js · articles.js
 */
(function () {
  'use strict';

  var CHARS = window.DAZI_CHARS || [];
  var WORDS = window.DAZI_WORDS || [];
  var IDIOMS = window.DAZI_IDIOMS || [];
  var ARTS = window.DAZI_ARTICLES || [];

  var PAGE = { char: 40, word: 12, word4: 10, article: 1, endless: 40 };
  var MODE_NAME = { char: '单字', word: '词语', word4: '四字', article: '文章', endless: '无限' };
  var LS = {
    rec: 'dazi.records',
    theme: 'dazi.theme',
    sound: 'dazi.sound',
    art: 'dazi.article'
  };

  /* ---------------- 随机 ---------------- */
  // 从数组里随机取 n 个不重复的元素
  function pick(arr, n) {
    var copy = arr.slice(), out = [];
    var take = Math.min(n, copy.length);
    for (var i = 0; i < take; i++) {
      out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    return out;
  }

  /* ---------------- 存储 ---------------- */
  function load(key, dflt) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? dflt : JSON.parse(v);
    } catch (e) { return dflt; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  /* ---------------- 状态 ---------------- */
  var S = {
    mode: 'char',
    items: [],
    idx: 0,
    pos: 0,
    keys: 0,
    good: 0,
    doneChar: 0,
    wrongChar: 0,
    t0: 0,
    paused: false,
    pausedAt: 0,
    pausedTotal: 0,
    finished: false,
    sound: load(LS.sound, true),
    artCur: -1
  };

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var elLines = $('lines');
  var elPaper = $('paper');
  var elTip = $('tip');
  var elKbd = $('kbd');
  var elRec = $('reclist');
  var elSpark = $('spark');
  var elToast = $('toast');
  var mProgress = $('m-progress');
  var mSpeed = $('m-speed');
  var mAcc = $('m-acc');
  var mTime = $('m-time');

  var unitEls = [];

  /* ---------------- 音效 ---------------- */
  var actx = null;
  function audio() {
    if (!S.sound) return null;
    if (!actx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      actx = new Ctx();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(freq, dur, type, gain) {
    var ac = audio();
    if (!ac) return;
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || 'triangle';
    o.frequency.value = freq;
    g.gain.value = 0;
    o.connect(g); g.connect(ac.destination);
    var t = ac.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain || 0.05, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function sndHit() { beep(1180, 0.035, 'square', 0.028); }
  function sndMiss() { beep(148, 0.12, 'sawtooth', 0.05); }
  function sndDone() {
    beep(660, 0.08, 'triangle', 0.045);
    setTimeout(function () { beep(880, 0.1, 'triangle', 0.045); }, 85);
    setTimeout(function () { beep(1180, 0.16, 'triangle', 0.04); }, 175);
  }

  /* ---------------- 取题 ---------------- */
  function buildItems() {
    var i, j, out = [];

    if (S.mode === 'char' || S.mode === 'endless') {
      var pool = pick(CHARS, PAGE.char);
      for (i = 0; i < pool.length; i++) {
        out.push({ c: pool[i][0], p: pool[i][1], tail: 0 });
      }
      return out;
    }

    if (S.mode === 'word' || S.mode === 'word4') {
      var src = S.mode === 'word' ? WORDS : IDIOMS;
      var words = pick(src, PAGE[S.mode]);
      for (i = 0; i < words.length; i++) {
        var w = words[i];
        for (j = 0; j < w.length; j++) {
          out.push({ c: w[j][0], p: w[j][1], tail: (j === w.length - 1) ? 1 : 0 });
        }
      }
      return out;
    }

    // article：每轮随机换一篇，不重复上一篇
    if (!ARTS.length) return [];
    var a = ARTS[S.artCur < 0 ? 0 : S.artCur];
    for (i = 0; i < a.s.length; i++) {
      out.push({ c: a.s[i][0], p: a.s[i][1], tail: 0 });
    }
    return out;
  }

  function modeHint() {
    if (S.mode === 'char') return '随机取 ' + PAGE.char + ' 个常用字 · 共 ' + CHARS.length + ' 字';
    if (S.mode === 'word') return '高频双字词 · 词库 ' + WORDS.length + ' 个 · 每组 ' + PAGE.word + ' 词';
    if (S.mode === 'word4') return '常用四字成语 · 词库 ' + IDIOMS.length + ' 条 · 每组 ' + PAGE.word4 + ' 条';
    if (S.mode === 'endless') return '一直往下打 · 打完自动续 · 不会停';
    var a = ARTS[S.artCur < 0 ? 0 : S.artCur];
    return '短文跟打 · 共 ' + ARTS.length + ' 篇 · 随机选 · 当前《' + a.t + '》';
  }

  /* ---------------- 渲染 ---------------- */
  // errs = 这个字里打错过的字母位置。当前位置优先显示光标（cur），
  // 如果它同时也是错的，就带上 bad 一起显示，既知道打哪、也知道这儿错过。
  function pyHtml(p, pos, active, errs) {
    var s = '';
    for (var i = 0; i < p.length; i++) {
      var isErr = !!(errs && errs.indexOf(i) >= 0);
      var cls;
      if (active && i === pos) cls = isErr ? 'cur bad' : 'cur';
      else if (isErr) cls = 'bad';
      else if (active && i < pos) cls = 'done';
      else cls = '';
      s += cls ? '<em class="' + cls + '">' + p.charAt(i) + '</em>'
               : '<em>' + p.charAt(i) + '</em>';
    }
    return s;
  }

  function mkUnit(it) {
    var u = document.createElement('div');
    u.className = 'u' + (it.p ? '' : ' is-punct');
    u.innerHTML =
      '<span class="py">' + (it.p ? pyHtml(it.p, 0, false, it.errs) : '') + '</span>' +
      '<span class="hz">' + it.c + '</span>';
    return u;
  }

  function isWordMode() { return S.mode === 'word' || S.mode === 'word4'; }

  function renderPage() {
    elLines.innerHTML = '';
    elLines.className = 'lines' + (isWordMode() ? ' is-word' : '');
    unitEls = [];
    var frag = document.createDocumentFragment();
    var group = null, last = null;

    function mkGroup() {
      var g = document.createElement('div');
      g.className = 'w';
      frag.appendChild(g);
      return g;
    }

    for (var i = 0; i < S.items.length; i++) {
      var it = S.items[i];

      if (isWordMode()) {
        if (!group) group = mkGroup();
      } else if (it.p) {
        group = mkGroup();
      } else {
        // 标点并入前一组，永远不出现在行首
        group = last || mkGroup();
      }

      var u = mkUnit(it);
      group.appendChild(u);
      unitEls.push(u);
      last = group;

      if (isWordMode() && it.tail) group = null;
    }
    elLines.appendChild(frag);
    markCur();
  }

  // 无限模式：往末尾续一批新题，不打断当前输入
  function appendItems(list) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      S.items.push(it);
      var g = document.createElement('div');
      g.className = 'w';
      var u = mkUnit(it);
      g.appendChild(u);
      frag.appendChild(g);
      unitEls.push(u);
    }
    elLines.appendChild(frag);
  }

  function paintUnit(i) {
    var it = S.items[i], el = unitEls[i];
    if (!el || !it.p) return;
    var py = el.querySelector('.py');
    if (py) py.innerHTML = pyHtml(it.p, i === S.idx ? S.pos : 0, i === S.idx, it.errs);
  }

  function markCur() {
    for (var i = 0; i < unitEls.length; i++) {
      unitEls[i].classList.remove('is-cur');
      // 打错过的字保持 is-wrong，别再叠一个 is-done 上去
      if (i < S.idx && !unitEls[i].classList.contains('is-wrong')) {
        unitEls[i].classList.add('is-done');
      }
    }
    var cur = unitEls[S.idx];
    if (cur) {
      cur.classList.add('is-cur');
      cur.classList.remove('is-done');
      var r = cur.getBoundingClientRect();
      var pr = elPaper.getBoundingClientRect();
      if (r.bottom > pr.bottom - 20 || r.top < pr.top + 4) {
        cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    paintUnit(S.idx);
    paintNextKey();
  }

  function flashMiss() {
    var el = unitEls[S.idx];
    if (!el) return;
    el.classList.remove('is-miss');
    void el.offsetWidth;
    el.classList.add('is-miss');
    setTimeout(function () { el.classList.remove('is-miss'); }, 300);
  }

  /* ---------------- 虚拟键盘 ---------------- */
  var ROWS = [
    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', { t: 'Backspace', w: 'wide', sp: 1 }],
    [{ t: 'Tab', w: 'wide', sp: 1 }, 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
    [{ t: 'Caps', w: 'wide', sp: 1 }, 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'", { t: 'Enter', w: 'wide', sp: 1 }],
    [{ t: 'Shift', w: 'wide', sp: 1 }, 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', { t: 'Shift', w: 'wide', sp: 1 }],
    [{ t: 'Ctrl', w: 'wide', sp: 1 }, { t: 'Alt', w: 'wide', sp: 1 }, { t: 'Space', w: 'space', sp: 1 }, { t: 'Alt', w: 'wide', sp: 1 }, { t: 'Menu', w: 'wide', sp: 1 }]
  ];
  var LEFT_SHIFT = '`12345qwertasdfgzxcvb';
  var RIGHT_SHIFT = '67890-=yuiop[]\\hjkl;\'nm,./';
  var keyMap = {};

  function buildKbd() {
    elKbd.innerHTML = '';
    keyMap = {};
    for (var r = 0; r < ROWS.length; r++) {
      var row = document.createElement('div');
      row.className = 'krow';
      for (var k = 0; k < ROWS[r].length; k++) {
        var spec = ROWS[r][k];
        var label = typeof spec === 'string' ? spec : spec.t;
        var el = document.createElement('div');
        el.className = 'key';
        if (typeof spec === 'object') {
          el.classList.add('sp');
          if (spec.w) el.classList.add(spec.w);
          if (label === 'Space') el.textContent = '';
          else el.textContent = label;
        } else {
          el.textContent = label;
          if (LEFT_SHIFT.indexOf(label) >= 0) el.classList.add('hand-l');
          else if (RIGHT_SHIFT.indexOf(label) >= 0) el.classList.add('hand-r');
          else el.classList.add('hand-t');
        }
        row.appendChild(el);
        if (typeof spec === 'string') keyMap[label] = el;
      }
      elKbd.appendChild(row);
    }
  }

  var lastNext = null;
  function paintNextKey() {
    if (lastNext) { lastNext.classList.remove('is-next'); lastNext = null; }
    var it = S.items[S.idx];
    if (!it || !it.p) return;
    var ch = it.p.charAt(S.pos);
    var el = keyMap[ch];
    if (el) { el.classList.add('is-next'); lastNext = el; }
  }

  function flashKey(ch, ok) {
    var el = keyMap[ch];
    if (!el) return;
    var cls = ok ? 'is-hit' : 'is-miss';
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 150);
  }

  /* ---------------- 计时与指标 ---------------- */
  function elapsed() {
    if (!S.t0) return 0;
    var end = S.paused ? S.pausedAt : Date.now();
    return Math.max(0, end - S.t0 - S.pausedTotal);
  }

  function fmtTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function renderMeters() {
    if (S.mode === 'endless') {
      mProgress.textContent = S.doneChar + ' 字';
    } else {
      var total = 0;
      for (var i = 0; i < S.items.length; i++) if (S.items[i].p) total++;
      mProgress.textContent = S.doneChar + '/' + total;
    }
    var ms = elapsed();
    // 前 3 秒按 3 秒计，避免开头几字符把速度冲成几百
    var min = Math.max(ms, 3000) / 60000;
    var sp = S.t0 ? Math.round(S.doneChar / min) : 0;
    mSpeed.textContent = sp;
    var acc = S.keys ? Math.round(S.good / S.keys * 100) : 100;
    mAcc.innerHTML = acc + '<i class="pct">%</i>';
    mTime.textContent = fmtTime(ms);
  }

  var tick = null;
  function startTick() {
    if (tick) return;
    tick = setInterval(function () {
      if (!S.paused && !S.finished) renderMeters();
    }, 250);
  }

  /* ---------------- 键盘事件 ---------------- */
  function isTyping(c) { return /^[a-z]$/i.test(c); }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') { e.preventDefault(); restart(); return; }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (S.finished) return;
      if (S.pos > 0) {
        S.pos--;
        paintUnit(S.idx);
        paintNextKey();
        renderMeters();
      }
      return;
    }
    if (e.key === 'Tab') return;

    if (!isTyping(e.key)) return;
    e.preventDefault();
    if (S.paused || S.finished) {
      if (S.paused) togglePause();
      else return;
    }
    press(e.key.toLowerCase());
  }

  function press(ch) {
    if (!S.t0) { S.t0 = Date.now(); elTip.classList.add('is-hide'); startTick(); }
    if (S.finished) return;

    var it = S.items[S.idx];
    if (!it) return;
    if (!it.p) { advance(); return; }

    S.keys++;
    if (ch === it.p.charAt(S.pos)) {
      S.good++;
      // 之前在这个位置错过，现在补对了就把红标清掉
      if (it.errs && it.errs.length) {
        var k = it.errs.indexOf(S.pos);
        if (k >= 0) it.errs.splice(k, 1);
      }
      sndHit();
      flashKey(ch, true);
    } else {
      // 打错一个字母：只记下这个位置，不卡住，继续打同一个字剩下的字母
      sndMiss();
      flashKey(ch, false);
      flashMiss();
      if (!it.errs) it.errs = [];
      if (it.errs.indexOf(S.pos) < 0) it.errs.push(S.pos);
    }

    S.pos++;
    if (S.pos >= it.p.length) {
      advance();
    } else {
      paintUnit(S.idx);
      paintNextKey();
    }
    renderMeters();
  }

  function advance() {
    var it = S.items[S.idx];
    var hasErr = !!(it && it.errs && it.errs.length);
    if (it && it.p) {
      S.doneChar++;
      if (hasErr) S.wrongChar++;
    }
    var el = unitEls[S.idx];
    if (el) {
      el.classList.remove('is-cur', 'is-miss');
      el.classList.add(hasErr ? 'is-wrong' : 'is-done');
      // 收尾时把拼音整体刷成"已完成"，否则会停在最后一个字母高亮的状态
      if (it && it.p) {
        var py = el.querySelector('.py');
        if (py) py.innerHTML = pyHtml(it.p, it.p.length, true, it.errs);
      }
    }
    S.idx++;
    S.pos = 0;
    // 跳过标点
    while (S.idx < S.items.length && !S.items[S.idx].p) {
      if (unitEls[S.idx]) unitEls[S.idx].classList.add('is-done');
      S.idx++;
    }

    // 无限模式：剩不到 20 个字就续一批，页面上永远有内容可打
    if (S.mode === 'endless' && S.items.length - S.idx < 20) {
      appendItems(buildItems());
      if (S.doneChar > 0 && S.doneChar % 50 === 0) {
        var ms = elapsed();
        var min = Math.max(ms, 3000) / 60000;
        pushRecord(Math.round(S.doneChar / min), S.keys ? Math.round(S.good / S.keys * 100) : 100, ms);
        toast('已打 ' + S.doneChar + ' 字 · ' + Math.round(S.doneChar / min) + ' 字/分');
      }
    }

    if (S.idx >= S.items.length) { finish(); return; }
    markCur();
    renderMeters();
  }

  function finish() {
    S.finished = true;
    var ms = elapsed();
    var min = Math.max(ms, 3000) / 60000;
    var sp = Math.round(S.doneChar / min);
    var acc = S.keys ? Math.round(S.good / S.keys * 100) : 100;

    sndDone();
    pushRecord(sp, acc, ms);
    renderMeters();

    setTimeout(function () {
      toast('完成 · ' + sp + ' 字/分 · 正确率 ' + acc + '%');
    }, 120);

    setTimeout(function () { newRound(); }, 1500);
  }

  /* ---------------- 记录 ---------------- */
  function pushRecord(sp, acc, ms) {
    var arr = load(LS.rec, []);
    arr.unshift({ ts: Date.now(), mode: S.mode, sp: sp, acc: acc, ms: ms, n: S.doneChar });
    arr = arr.slice(0, 20);
    save(LS.rec, arr);
    renderRecords();
  }

  function renderRecords() {
    var arr = load(LS.rec, []);
    elRec.innerHTML = '';
    if (!arr.length) {
      elRec.innerHTML = '<li class="empty">还没有记录。<br>打完一组就会出现。</li>';
      renderSpark([]);
      return;
    }
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      var li = document.createElement('li');
      var d = new Date(r.ts);
      var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      li.innerHTML =
        '<span class="r-mode">' + (MODE_NAME[r.mode] || '') + ' · ' + hh + '</span>' +
        '<span class="r-sp">' + r.sp + '</span>' +
        '<span class="r-ac">' + r.acc + '%</span>';
      elRec.appendChild(li);
    }
    renderSpark(arr.slice(0, 20).reverse());
  }

  function renderSpark(data) {
    var W = 260, H = 64, pad = 4;
    elSpark.innerHTML = '';
    if (data.length < 2) {
      elSpark.innerHTML = '<line x1="0" y1="' + (H - pad) + '" x2="' + W + '" y2="' + (H - pad) +
        '" stroke="currentColor" stroke-opacity=".18" stroke-width="1"/>';
      return;
    }
    var max = Math.max.apply(null, data.map(function (d) { return d.sp; })) || 1;
    max = Math.max(max, 40);
    var stepX = (W - pad * 2) / (data.length - 1);
    var pts = data.map(function (d, i) {
      var x = pad + i * stepX;
      var y = H - pad - (d.sp / max) * (H - pad * 2);
      return [x, y];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - pad) + ' L' + pts[0][0].toFixed(1) + ' ' + (H - pad) + ' Z';
    var ns = 'http://www.w3.org/2000/svg';
    var g = document.createElementNS(ns, 'path');
    g.setAttribute('d', area);
    g.setAttribute('fill', 'currentColor');
    g.setAttribute('fill-opacity', '.07');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', line);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-opacity', '.55');
    p.setAttribute('stroke-width', '1.4');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('stroke-linecap', 'round');
    elSpark.appendChild(g);
    elSpark.appendChild(p);
    var last = pts[pts.length - 1];
    var dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', last[0].toFixed(1));
    dot.setAttribute('cy', last[1].toFixed(1));
    dot.setAttribute('r', '2.4');
    dot.setAttribute('fill', 'currentColor');
    elSpark.appendChild(dot);
  }

  /* ---------------- 控制 ---------------- */
  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { elToast.classList.remove('is-on'); }, 1700);
  }

  function resetStats() {
    S.idx = 0; S.pos = 0; S.keys = 0; S.good = 0; S.doneChar = 0; S.wrongChar = 0;
    S.t0 = 0; S.pausedTotal = 0; S.pausedAt = 0; S.finished = false; S.paused = false;
    elTip.classList.remove('is-hide');
    renderMeters();
  }

  function newRound() {
    resetStats();
    // 文章每次随机换一篇，绝不连着重复
    if (S.mode === 'article' && ARTS.length) {
      var n = Math.floor(Math.random() * ARTS.length);
      if (ARTS.length > 1 && n === S.artCur) n = (n + 1) % ARTS.length;
      S.artCur = n;
      save(LS.art, S.artCur);
    }
    S.items = buildItems();
    renderPage();
    document.getElementById('mode-hint').textContent = modeHint();
    renderMeters();
    elPaper.scrollTop = 0;
  }

  // 重来 = 同一组重打一遍，不换题
  function restart() {
    resetStats();
    renderPage();
    renderMeters();
    elPaper.scrollTop = 0;
    elPaper.focus();
  }

  function togglePause() {
    if (S.finished || !S.t0) return;
    if (S.paused) {
      S.pausedTotal += Date.now() - S.pausedAt;
      S.paused = false;
      $('btn-pause').textContent = '暂停';
      elTip.classList.add('is-hide');
    } else {
      S.pausedAt = Date.now();
      S.paused = true;
      $('btn-pause').textContent = '继续';
      elTip.textContent = '已暂停 · 按任意字母继续';
      elTip.classList.remove('is-hide');
    }
  }

  function setMode(m) {
    S.mode = m;
    var btns = document.querySelectorAll('.mode');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-mode') === m;
      btns[i].classList.toggle('is-on', on);
      btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    newRound();
    elPaper.focus();
  }

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    save(LS.theme, t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#131518' : '#f2f1ed');
  }

  /* ---------------- 绑定 ---------------- */
  var TIP_START = window.matchMedia('(max-width:820px)').matches
    ? '建议在电脑上练习；手机端没有物理键盘，无法跟打'
    : '敲下任意字母开始计时 · Esc 重来';

  function init() {
    setTheme(load(LS.theme, 'light'));
    buildKbd();
    renderRecords();

    S.items = buildItems();
    renderPage();
    document.getElementById('mode-hint').textContent = modeHint();
    renderMeters();
    elTip.textContent = TIP_START;

    document.addEventListener('keydown', onKey);
    elPaper.addEventListener('click', function () { elPaper.focus(); });

    document.querySelectorAll('.mode').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
    });

    $('btn-pause').addEventListener('click', function () { togglePause(); });
    $('btn-redo').addEventListener('click', function () { restart(); });
    $('btn-next').addEventListener('click', function () { newRound(); });

    $('btn-sound').addEventListener('click', function () {
      S.sound = !S.sound;
      save(LS.sound, S.sound);
      this.classList.toggle('is-active', S.sound);
      this.setAttribute('aria-pressed', String(S.sound));
      if (S.sound) sndHit();
    });

    $('btn-theme').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });

    $('btn-clear-rec').addEventListener('click', function () {
      save(LS.rec, []);
      renderRecords();
      toast('记录已清空');
    });

    // 初始音效按钮状态
    $('btn-sound').classList.toggle('is-active', S.sound);

    // 失焦暂停
    window.addEventListener('blur', function () {
      if (S.t0 && !S.paused && !S.finished) togglePause();
    });

    window.addEventListener('beforeunload', function () {
      if (tick) clearInterval(tick);
    });

    elPaper.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
