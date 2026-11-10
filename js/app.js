import { parseMidi, GM_NAMES } from './midi.js';
import { CHIPS, TONES } from './chips.js';
import { VGM_SUPPORTED } from './vgm.js';
import { isAY, parseAY, runAY } from './ay.js';
import { isVGM, unpackVGM, parseVGM } from './vgmin.js';

// chiptune.app の API と曲ファイルは chiptune.app と localhost からしか読めない。
// それ以外 (GitHub Pages の公開ページ) では Cloudflare Workers の中継 (proxy/worker.js) を通す。
const PROXY = 'https://chip-swap-proxy.zitnei.workers.dev';
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const API = 'https://chiptune.app/api';
const FILES = LOCAL ? 'https://gifx.co/music/' : PROXY + '/music/';
const $ = (id) => document.getElementById(id);
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE[n % 12] + (Math.floor(n / 12) - 1);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const isMidi = (p) => /\.(mid|midi|kar|rmi|ay|vgm|vgz)$/i.test(p);
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

const state = {
  song: null, chip: 'ym2612', scale: 1, mutes: new Array(64).fill(false), tones: new Array(64).fill(null),
  playing: false, time: 0, path: '/', curFile: null,
};

// ---------- オーディオ ----------
let ctx, node, gain, analyser;
async function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
  ctx = new AudioContext({ latencyHint: 'playback' });
  await ctx.audioWorklet.addModule('js/worklet.js');
  node = new AudioWorkletNode(ctx, 'chip-player', { outputChannelCount: [2] });
  gain = ctx.createGain(); gain.gain.value = $('volume').value / 100;
  analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  node.connect(gain).connect(analyser).connect(ctx.destination);
  node.port.onmessage = (e) => onStatus(e.data);
  post({ type: 'chip', id: state.chip, scale: state.scale });
  post({ type: 'mutes', value: state.mutes });
  post({ type: 'tones', value: state.tones });
  post({ type: 'loop', value: $('loopChk').checked });
  if (state.song) post(loadMsg());
  drawScope();
}
const post = (m) => node && node.port.postMessage(m);

function onStatus(s) {
  state.time = s.time;
  if (state.playing && !s.playing) setPlaying(false);
  if (!seeking && state.song) $('seek').value = Math.round(s.time / Math.max(1, state.song.duration) * 1000);
  if (state.song) $('time').textContent = `${fmt(Math.min(s.time, state.song.duration))} / ${fmt(state.song.duration)}`;
  renderHw(s.chans);
}

function setPlaying(p) {
  state.playing = p;
  $('playBtn').textContent = p ? '❚❚ 一時停止' : '▶ 再生';
}

const loadMsg = () => state.song.zx ? { type: 'load', zx: state.song.zx } : state.song.reg ? { type: 'load', reg: state.song.reg } : { type: 'load', events: state.song.events, duration: state.song.duration };

// ---------- 曲の読み込み ----------
async function loadSong(buf, name, sub, path = '', songId = null) {
  setOrigLink(songId);
  if (isAY(buf)) return loadZX(buf, name, sub, /\/CPC\//i.test(path));
  $('subRow').hidden = true;
  if (isVGM(buf)) return loadVGM(buf, name, sub);
  let song;
  try { song = parseMidi(buf); } catch (e) { alert('読み込めませんでした: ' + e.message); return; }
  if (!song.events.some((e) => e.type === 'on')) { alert('ノートが入っていない MIDI です'); return; }
  state.song = song;
  state.mutes.fill(false); state.tones.fill(null);
  $('songTitle').textContent = name;
  $('songSub').textContent = (song.title && song.title !== name ? song.title + ' ・ ' : '') + sub;
  for (const id of ['playBtn', 'stopBtn', 'seek', 'exportBtn']) $(id).disabled = false;
  updateVgmBtn();
  renderParts();
  await ensureAudio();
  post({ type: 'mutes', value: state.mutes });
  post({ type: 'tones', value: state.tones });
  post({ type: 'load', events: song.events, duration: song.duration });
  post({ type: 'play' }); setPlaying(true);
}

function setOrigLink(songId) {
  const a = $('origLink');
  a.hidden = !songId;
  if (songId) a.href = 'https://chiptune.app/?play=' + encodeURIComponent(songId);
}

// ---------- VGM (アーケード基板などの音源チップ命令の記録) ----------
async function loadVGM(buf, name, sub) {
  let src;
  try { src = parseVGM(await unpackVGM(buf)); } catch (e) { $('songSub').textContent = '読み込めませんでした: ' + e.message; return; }
  const nv = src.voices.length;
  let active = 0;
  for (let i = 0; i < src.count * nv; i++) if (src.data[i * 3 + 2] & 1) { active++; break; }
  if (!active && !src.hits.length) {
    $('songTitle').textContent = name;
    $('songSub').textContent = `この曲は音程を読み取れる音源を使っていません (${[...src.chips, ...src.unsupported].join(' / ') || '不明'})。PCM だけで鳴らす基板は非対応です`;
    return;
  }
  state.song = { reg: src, duration: src.duration };
  state.mutes.fill(false); state.tones.fill(null);
  $('songTitle').textContent = name.replace(/\.vg[mz]$/i, '');
  const chipsTxt = '元の音源: ' + src.chips.join(' + ') + (src.unsupported.length ? ` (${src.unsupported.join('・')} は鳴らせません)` : '');
  $('songSub').textContent = [sub, chipsTxt].filter(Boolean).join(' ・ ');
  for (const id of ['playBtn', 'stopBtn', 'seek', 'exportBtn']) $(id).disabled = false;
  updateVgmBtn();
  renderParts();
  await ensureAudio();
  post({ type: 'mutes', value: state.mutes });
  post({ type: 'tones', value: state.tones });
  post(loadMsg());
  post({ type: 'play' }); setPlaying(true);
}

// ---------- ZX チューン (.ay) ----------
let zxFile = null;
async function loadZX(buf, name, sub, cpc) {
  try { zxFile = { ay: parseAY(buf), name, sub, cpc }; } catch (e) { alert('読み込めませんでした: ' + e.message); return; }
  const sel = $('subSel'); sel.innerHTML = '';
  zxFile.ay.songs.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${i + 1}. ${s.name || '(無題)'}`; sel.append(o); });
  sel.value = Math.min(zxFile.ay.first, zxFile.ay.songs.length - 1);
  $('subRow').hidden = zxFile.ay.songs.length < 2;
  // ZX チューンは まず実機 (AY-3-8912) の音で
  if (state.chip !== 'zx128') selectChip('zx128');
  await playZXSong(+sel.value);
}
async function playZXSong(i) {
  const s = zxFile.ay.songs[i];
  $('songTitle').textContent = s.name || zxFile.name;
  $('songSub').textContent = 'Z80 で実行中…';
  await new Promise((r) => setTimeout(r, 20));
  let zx;
  try { zx = runAY(s, { cpc: zxFile.cpc }); } catch (e) { $('songSub').textContent = '再生できませんでした: ' + e.message; return; }
  let used = false;
  for (let f = 0; f < zx.count && !used; f++) used = (zx.frames[f * 16 + 8] | zx.frames[f * 16 + 9] | zx.frames[f * 16 + 10]) & 31;
  if (!used) { $('songSub').textContent = 'この曲は AY 音源を使っていません (ビーパー曲のため非対応)'; return; }
  state.song = { zx, duration: zx.count / 50, channels: null };
  state.mutes.fill(false); state.tones.fill(null);
  $('songSub').textContent = [zxFile.ay.author, zxFile.ay.misc, zxFile.cpc ? 'Amstrad CPC' : 'ZX Spectrum', zxFile.sub].filter(Boolean).join(' ・ ');
  for (const id of ['playBtn', 'stopBtn', 'seek', 'exportBtn']) $(id).disabled = false;
  updateVgmBtn();
  renderParts();
  await ensureAudio();
  post({ type: 'mutes', value: state.mutes });
  post({ type: 'tones', value: state.tones });
  post(loadMsg());
  post({ type: 'play' }); setPlaying(true);
}
$('subSel').onchange = (e) => playZXSong(+e.target.value);

async function loadRemote(path, songId = null) {
  $('songSub').textContent = '読み込み中…';
  try {
    const r = await fetch(FILES + enc(path));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.curFile = path;
    markCurrent();
    const parts = path.split('/');
    await loadSong(await r.arrayBuffer(), parts.pop(), parts.join(' / '), path, songId);
  } catch (e) { $('songSub').textContent = 'ダウンロード失敗: ' + e.message; }
}

// ---------- chiptune.app ブラウザ ----------
// chiptune.app の API は localhost 以外 (GitHub Pages など) からは使えないため、
// その場合は同梱の曲リスト (catalog/) に切り替える。曲ファイル本体は gifx.co から直接読める。
let useCatalog = LOCAL ? null : true; // 公開ページは最初から同梱リストを使う
const catalog = { index: null, tops: {} };
async function apiFetch(url) {
  if (useCatalog !== true) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      useCatalog = false;
      return j;
    } catch (e) { if (useCatalog === false) throw e; useCatalog = true; }
  }
  return null;
}
const catIndex = async () => (catalog.index ??= await fetch('catalog/index.json').then((r) => r.json()));
async function catTop(name) {
  if (catalog.tops[name]) return catalog.tops[name];
  const t = (await catIndex()).tops.find((x) => x.name === name);
  if (!t) return {};
  return (catalog.tops[name] = await fetch('catalog/' + t.file).then((r) => r.json()));
}
async function catalogBrowse(path) {
  const idx = await catIndex();
  if (path === '/') return idx.tops.map((t) => ({ path: t.name, type: 'directory', count: t.files }));
  const dirs = await catTop(path.split('/')[1]);
  const base = path.slice(1);
  return (dirs[path] || []).map((e) => (typeof e[1] === 'number' ? { path: base + '/' + e[0], type: 'directory', count: e[1] } : { path: base + '/' + e[0], type: 'file', songId: e[1] || null }));
}
async function catalogSearch(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const res = [];
  for (const t of (await catIndex()).tops) {
    const dirs = await catTop(t.name);
    for (const [p, list] of Object.entries(dirs)) {
      const lp = p.toLowerCase();
      for (const e of list) {
        if (typeof e[1] === 'number') continue;
        const full = lp + '/' + e[0].toLowerCase();
        if (words.every((w) => full.includes(w))) { res.push({ file: p.slice(1) + '/' + e[0], song_id: e[1] || null }); if (res.length >= 500) return res; }
      }
    }
  }
  return res;
}
const catalogNote = () => (useCatalog && catalog.index ? `(収録リスト: ${catalog.index.updated} 時点)` : '');

async function browse(path) {
  state.path = path;
  renderCrumbs();
  const ul = $('list');
  ul.innerHTML = '<li class="msg">読み込み中…</li>';
  try {
    const items = (await apiFetch(`${API}/browse?path=${encodeURIComponent(path)}`)) || (await catalogBrowse(path));
    ul.innerHTML = '';
    if (useCatalog && path === '/') { const n = document.createElement('li'); n.className = 'msg'; n.textContent = catalogNote(); ul.append(n); }
    if (path !== '/') addItem('📁 ..', () => browse(path.replace(/\/[^/]+$/, '') || '/'));
    // ルートでは MIDI を含むフォルダを先頭に
    if (path === '/') items.sort((a, b) => (/midi|project ay|vgm rips/i.test(b.path) - /midi|project ay|vgm rips/i.test(a.path)));
    for (const it of items) {
      const name = it.path.split('/').pop();
      if (it.type === 'directory') addItem('📁 ' + name, () => browse('/' + it.path), it.count + '曲');
      else addItem('♪ ' + name, isMidi(name) ? () => loadRemote(it.path, it.songId) : null, null, it.path);
    }
    markCurrent();
  } catch (e) { msg(`取得できませんでした (${e.message})`); }
}

function addItem(label, onClick, count, file) {
  const li = document.createElement('li');
  li.textContent = label;
  li.title = label;
  if (file) li.dataset.file = file;
  if (count) { const s = document.createElement('span'); s.className = 'n'; s.textContent = count; li.append(s); }
  if (onClick) li.onclick = onClick;
  else { li.classList.add('off'); li.title = 'MIDI 以外は非対応'; }
  $('list').append(li);
}
function markCurrent() { for (const li of $('list').children) li.classList.toggle('cur', li.dataset.file === state.curFile); }

function renderCrumbs() {
  const c = $('crumbs'); c.innerHTML = '';
  const parts = state.path.split('/').filter(Boolean);
  const root = document.createElement('a'); root.textContent = 'chiptune.app'; root.onclick = () => browse('/'); c.append(root);
  parts.forEach((p, i) => {
    c.append(' / ');
    const a = document.createElement('a'); a.textContent = p; a.onclick = () => browse('/' + parts.slice(0, i + 1).join('/')); c.append(a);
  });
}

$('searchForm').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('searchInput').value.trim();
  if (!q) return browse(state.path);
  const ul = $('list'); ul.innerHTML = '<li class="msg">検索中…</li>';
  $('crumbs').textContent = `検索: "${q}" (MIDI・ZX のみ)`;
  try {
    if (useCatalog) $('crumbs').textContent += ' ・ 曲リストを読み込み中…';
    const res = await apiFetch(`${API}/search?query=${encodeURIComponent(q)}&limit=500`);
    const items = (res ? res.items : await catalogSearch(q)).filter((it) => isMidi(it.file));
    $('crumbs').textContent = `検索: "${q}" (MIDI・ZX のみ) ${catalogNote()}`;
    ul.innerHTML = '';
    addItem('📁 フォルダ表示に戻る', () => browse(state.path));
    if (!items.length) addItem('見つかりませんでした', null);
    for (const it of items) {
      const parts = it.file.split('/');
      addItem('♪ ' + parts.slice(-2).join(' / '), () => loadRemote(it.file, it.song_id), null, it.file);
    }
    markCurrent();
  } catch (err) { msg(`検索できませんでした (${err.message})`); }
};

// ---------- ローカルファイル ----------
const drop = $('drop');
$('fileInput').onchange = (e) => readLocal(e.target.files[0]);
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); readLocal(e.dataTransfer.files[0]); };
async function readLocal(f) { if (f) { state.curFile = null; await loadSong(await f.arrayBuffer(), f.name, 'ローカルファイル'); } }
$('urlForm').onsubmit = async (e) => {
  e.preventDefault();
  const url = $('urlInput').value.trim(); if (!url) return;
  try {
    const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
    await loadSong(await r.arrayBuffer(), decodeURIComponent(url.split('/').pop()), url);
  } catch (err) { alert('取得できませんでした: ' + err.message); }
};

document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('tab-browse').classList.toggle('hidden', t.dataset.tab !== 'browse');
  $('tab-local').classList.toggle('hidden', t.dataset.tab !== 'local');
});

// ---------- 再生コントロール ----------
$('playBtn').onclick = async () => {
  await ensureAudio();
  if (state.playing) { post({ type: 'pause' }); setPlaying(false); }
  else { post({ type: 'play' }); setPlaying(true); }
};
$('stopBtn').onclick = () => { post({ type: 'pause' }); post({ type: 'seek', time: 0 }); setPlaying(false); };
let seeking = false;
$('seek').oninput = () => { seeking = true; };
$('seek').onchange = () => {
  seeking = false;
  if (state.song) post({ type: 'seek', time: $('seek').value / 1000 * state.song.duration });
};
$('loopChk').onchange = (e) => post({ type: 'loop', value: e.target.checked });
$('volume').oninput = (e) => { if (gain) gain.gain.value = e.target.value / 100; };
$('scaleSel').onchange = (e) => { state.scale = +e.target.value; post({ type: 'chip', id: state.chip, scale: state.scale }); };

// ---------- 音源選択 ----------
const TYPE_LABEL = { fm: 'FM音源', psg: 'PSG音源', wave: '波形メモリ音源' };
let chipFilter = 'all';
document.querySelectorAll('#chipFilter button').forEach((b) => b.onclick = () => {
  chipFilter = b.dataset.type;
  document.querySelectorAll('#chipFilter button').forEach((x) => x.classList.toggle('active', x === b));
  renderChips();
});
function renderChips() {
  const g = $('chipGrid'); g.innerHTML = '';
  for (const c of CHIPS) {
    if (chipFilter !== 'all' && c.type !== chipFilter) continue;
    const b = document.createElement('button');
    b.className = 'chip' + (c.id === state.chip ? ' active' : '');
    b.innerHTML = `<span class="maker"><b class="type"></b> </span><span class="name"></span><span class="sys"></span><span class="desc"></span>`;
    b.querySelector('.maker').append(c.maker);
    b.querySelector('.type').textContent = TYPE_LABEL[c.type];
    b.querySelector('.type').dataset.t = c.type;
    b.querySelector('.name').textContent = c.name;
    b.querySelector('.sys').textContent = c.system;
    b.querySelector('.desc').textContent = c.desc + (VGM_SUPPORTED.includes(c.id) ? '' : '  ※VGM書き出し非対応');
    b.onclick = () => selectChip(c.id);
    g.append(b);
  }
}

function selectChip(id) {
  state.chip = id;
  try { localStorage.setItem('chipswap.chip', id); } catch {}
  post({ type: 'chip', id, scale: state.scale });
  renderChips(); updateVgmBtn();
}

// ---------- MIDI パート (ZX は AY のチャンネル) ----------
function renderParts() {
  const tb = $('parts'); tb.innerHTML = '';
  if (state.song.reg) {
    const src = state.song.reg, nv = src.voices.length;
    const used = src.voices.map((_, v) => { for (let f = 0; f < src.count; f++) if (src.data[(f * nv + v) * 3 + 2] & 1) return true; return false; });
    const rows = src.voices.map((vo, v) => ({ v, label: vo.name, kind: vo.kind })).filter((r) => used[r.v]);
    if (src.hits.length) rows.push({ v: nv, label: 'ドラム (リズム音源・PCM)', kind: 'drum' });
    rows.forEach(({ v, label, kind }) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td class="inst"></td><td></td><td><input type="checkbox"></td>';
      tr.children[0].textContent = kind === 'fm' ? 'FM' : kind === 'drum' ? 'DR' : kind === 'noise' ? 'N' : 'PSG';
      tr.children[1].textContent = label; tr.children[1].title = label;
      if (kind === 'fm' || kind === 'psg') {
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">自動</option>' + Object.entries(TONES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
        sel.onchange = () => { state.tones[v] = sel.value || null; post({ type: 'tones', value: state.tones }); };
        tr.children[2].append(sel);
      } else tr.children[2].textContent = '—';
      const mute = tr.querySelector('input');
      mute.onchange = () => { state.mutes[v] = mute.checked; tr.classList.toggle('muted', mute.checked); post({ type: 'mutes', value: state.mutes }); };
      tb.append(tr);
    });
    return;
  }
  if (state.song.zx) {
    ['AY チャンネル A', 'AY チャンネル B', 'AY チャンネル C', 'ノイズ'].forEach((label, ch) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td class="inst"></td><td></td><td><input type="checkbox"></td>';
      tr.children[0].textContent = ch < 3 ? 'ABC'[ch] : 'N';
      tr.children[1].textContent = label;
      if (ch < 3) {
        const sel = document.createElement('select');
        sel.title = 'AY 以外の音源で鳴らす時の音色';
        sel.innerHTML = '<option value="">自動</option>' + Object.entries(TONES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
        sel.onchange = () => { state.tones[ch] = sel.value || null; post({ type: 'tones', value: state.tones }); };
        tr.children[2].append(sel);
      } else tr.children[2].textContent = '—';
      const mute = tr.querySelector('input');
      mute.onchange = () => { state.mutes[ch] = mute.checked; tr.classList.toggle('muted', mute.checked); post({ type: 'mutes', value: state.mutes }); };
      tb.append(tr);
    });
    return;
  }
  state.song.channels.forEach((c, ch) => {
    if (!c.notes) return;
    const tr = document.createElement('tr');
    const progs = [...c.programs];
    const inst = ch === 9 ? 'ドラム' : progs.map((p) => GM_NAMES[p]).join(', ');
    tr.innerHTML = `<td>${ch + 1}</td><td class="inst"></td><td></td><td><input type="checkbox"></td>`;
    tr.children[1].textContent = inst; tr.children[1].title = inst;
    if (ch !== 9) {
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">自動</option>' + Object.entries(TONES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('');
      sel.onchange = () => { state.tones[ch] = sel.value || null; post({ type: 'tones', value: state.tones }); };
      tr.children[2].append(sel);
    } else tr.children[2].textContent = '—';
    const mute = tr.querySelector('input');
    mute.onchange = () => { state.mutes[ch] = mute.checked; tr.classList.toggle('muted', mute.checked); post({ type: 'mutes', value: state.mutes }); };
    tb.append(tr);
  });
}

// ---------- チャンネルモニター ----------
let hwRows = [];
function renderHw(chans) {
  const box = $('hwChans');
  if (hwRows.length !== chans.length || box.dataset.chip !== state.chip + state.scale) {
    box.innerHTML = ''; box.dataset.chip = state.chip + state.scale;
    const count = {};
    hwRows = chans.map((c) => {
      count[c.label] = (count[c.label] || 0) + 1;
      const d = document.createElement('div'); d.className = 'ch';
      d.innerHTML = `<span class="lab">${c.label} ${count[c.label]}</span><span class="note"></span><span class="bar"><i></i></span><span class="src"></span>`;
      box.append(d);
      return { d, note: d.children[1], bar: d.children[2].firstChild, src: d.children[3] };
    });
  }
  chans.forEach((c, i) => {
    const r = hwRows[i];
    r.d.classList.toggle('drum', !!c.drum);
    r.note.textContent = c.busy ? (c.drum ? c.drum : noteName(c.note)) : '';
    r.bar.style.width = Math.min(100, c.lvl * 110) + '%';
    r.src.textContent = c.busy ? (c.src !== undefined ? c.src : `MIDI ${c.ch + 1}`) : '';
  });
}

// ---------- オシロスコープ ----------
function drawScope() {
  const cv = $('scope'), g = cv.getContext('2d');
  const data = new Float32Array(analyser.fftSize);
  const css = getComputedStyle(document.documentElement);
  const loop = () => {
    cv.width = cv.clientWidth;
    analyser.getFloatTimeDomainData(data);
    let start = 0;
    for (let i = 1; i < data.length / 2; i++) if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; }
    g.clearRect(0, 0, cv.width, cv.height);
    g.strokeStyle = css.getPropertyValue('--line'); g.lineWidth = 2; g.beginPath();
    const n = 1024, h = cv.height;
    for (let i = 0; i < n; i++) {
      const x = i / n * cv.width, y = h / 2 - data[start + i] * h * .9;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    requestAnimationFrame(loop);
  };
  loop();
}

// ---------- WAV / VGM 書き出し ----------
function runExport(format) {
  if (!state.song) return;
  const btn = $(format === 'vgm' ? 'vgmBtn' : 'exportBtn'), st = $('exportStatus');
  btn.disabled = true; st.textContent = format === 'vgm' ? 'VGM 変換中…' : 'レンダリング中… 0%';
  const w = new Worker('js/export-worker.js', { type: 'module' });
  const finish = (text) => { st.textContent = text; btn.disabled = false; updateVgmBtn(); w.terminate(); };
  w.onmessage = (e) => {
    if (e.data.type === 'progress') st.textContent = `レンダリング中… ${Math.round(e.data.value * 100)}%`;
    else if (e.data.type === 'error') finish('失敗: ' + e.data.message);
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(e.data.blob);
      const base = ($('songTitle').textContent || 'song').replace(/\.[^.]+$/, '');
      a.download = `${base} [${state.chip}].${format}`;
      a.click();
      finish(format === 'vgm' ? '完了 (VGMPlay・chiptune.app などで再生できます)' : '完了');
    }
  };
  w.onerror = (e) => finish('失敗: ' + e.message);
  const chip = CHIPS.find((c) => c.id === state.chip);
  w.postMessage({ format, ...exportSource(), chip: state.chip, scale: state.scale, mutes: state.mutes, tones: state.tones, sr: 44100,
    title: $('songTitle').textContent, game: state.curFile ? state.curFile.split('/').slice(-2, -1)[0] : '', system: `${chip.maker} ${chip.name}` });
}
function exportSource() { return state.song.zx ? { zx: state.song.zx, duration: state.song.duration } : state.song.reg ? { reg: state.song.reg, duration: state.song.duration } : { events: state.song.events, duration: state.song.duration }; }
$('exportBtn').onclick = () => runExport('wav');
$('vgmBtn').onclick = () => runExport('vgm');
function updateVgmBtn() {
  const ok = VGM_SUPPORTED.includes(state.chip);
  $('vgmBtn').disabled = !state.song || !ok;
  $('vgmBtn').title = ok ? '選んだ音源チップのレジスタ命令として書き出します' : 'この音源は VGM 形式に対応するチップがありません (ナムコ WSG/C30・K005289)';
}

// ---------- 起動 ----------
try { const saved = localStorage.getItem('chipswap.chip'); if (CHIPS.some((c) => c.id === saved)) state.chip = saved; } catch {}
renderChips();
browse('/');
function msg(text) { const ul = $('list'); ul.innerHTML = ''; const li = document.createElement('li'); li.className = 'msg'; li.textContent = text; ul.append(li); }
