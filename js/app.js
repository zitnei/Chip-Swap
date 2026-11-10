import { parseMidi, GM_NAMES } from './midi.js';
import { CHIPS, TONES } from './chips.js';
import { VGM_SUPPORTED } from './vgm.js';
import { isAY, parseAY, runAY } from './ay.js';
import { isVGM, unpackVGM, parseVGM } from './vgmin.js';

// chiptune.app の API と曲ファイルは chiptune.app と localhost からしか読めない。
// それ以外 (GitHub Pages の公開ページ) では Cloudflare Workers の中継 (proxy/worker.js) を通す。
const APP_VERSION = '20261110i'; // 更新したら index.html の ?v= と一緒に変える
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
let ctx, node, gain, analyser, audioInit = null;
// 何度呼んでも安全 (準備は 1 回だけ。タップ直後に呼べば、スマホでも音声を開始できる)
function ensureAudio() {
  unlockMobileAudio();
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  return (audioInit ??= initAudio().catch((e) => {
    audioInit = null;
    $('songSub').textContent = '音声を開始できませんでした (' + (e && e.message || e) + ')。ブラウザを最新にするか、別のブラウザでお試しください';
    throw e;
  }));
}
// iPhone はマナーモード (消音スイッチ) だと Web Audio の音が出ない。
// 再生用の音声として扱ってもらうため、無音の <audio> を流し、対応していれば audioSession を playback にする。
let unlockEl = null;
function unlockMobileAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (!unlockEl) {
    const n = 4000, buf = new ArrayBuffer(44 + n), d = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < 4; i++) d.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); d.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true);
    d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, 8000, true); d.setUint32(28, 8000, true);
    d.setUint16(32, 1, true); d.setUint16(34, 8, true); w(36, 'data'); d.setUint32(40, n, true);
    new Uint8Array(buf, 44).fill(128);
    unlockEl = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
    unlockEl.loop = true; unlockEl.setAttribute('playsinline', '');
  }
  unlockEl.play().catch(() => {});
}
// アプリを切り替えて戻った時などに、止まった音声を再開
document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && state.playing && ctx.state !== 'running') ctx.resume().catch(() => {}); });
async function initAudio() {
  ctx = new AudioContext({ latencyHint: 'playback' });
  // 音源エンジンは 1 ファイルにまとめたもの (tools/build-worklet.mjs) を読む。Safari では AudioWorklet 内の import が使えないことがあるため
  await ctx.audioWorklet.addModule('js/worklet.bundle.js?v=' + APP_VERSION);
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
  if (s.id !== (state.loadId || 0)) return;
  state.time = s.time;
  if (state.playing && !s.playing) {
    setPlaying(false);
    if (s.ended && $('nextChk').checked) playNext(1, true);
  }
  if (!seeking && state.song) $('seek').value = Math.round(s.time / Math.max(1, state.song.duration) * 1000);
  if (state.song) $('time').textContent = `${fmt(Math.min(s.time, state.song.duration))} / ${fmt(state.song.duration)}`;
  renderHw(s.chans);
}

function setPlaying(p) {
  state.playing = p;
  $('playBtn').textContent = p ? '❚❚ 一時停止' : '▶ 再生';
}

// 読み込みごとに番号を付け、前の曲の状態通知 (「終わった」など) を新しい曲のものと取り違えないようにする
let loadSeq = 0;
const loadMsg = () => {
  state.loadId = ++loadSeq;
  const m = state.song.zx ? { zx: state.song.zx } : state.song.reg ? { reg: state.song.reg } : { events: state.song.events, duration: state.song.duration };
  return { type: 'load', id: state.loadId, ...m };
};

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
  try { await ensureAudio(); } catch { return false; }
  post({ type: 'mutes', value: state.mutes });
  post({ type: 'tones', value: state.tones });
  post(loadMsg());
  post({ type: 'play' }); setPlaying(true);
}

// ---------- 元の音源で聴く / YouTube で探す ----------
// VGM: libvgm (chiptune.app と同じエミュレーター) をページ内で動かして、元の基板の音源で再生する。
// MIDI など VGM 以外: chiptune.app の再生画面をページ内に表示する。
function setOrigLink(songId) {
  state.songId = songId || null;
  state.origVgm = null;
  closeOrig();
  $('origBtn').disabled = !songId;
  $('origBtn').title = songId ? '元の基板・機種の音源で再生します (chiptune.app の再生画面)' : 'この曲は chiptune.app の曲ではないため、元の音源では聴けません';
  // YouTube 検索: ゲーム名 + 曲名
  const parts = (state.curFile || '').split('/');
  const game = parts.length > 1 ? splitTitle(parts.at(-2)).title : '';
  const track = (parts.at(-1) || '').replace(/\.[^.]+$/, '').replace(/^\d+\s*/, '');
  const q = [game, track].filter(Boolean).join(' ');
  $('ytBtn').hidden = !q;
  if (q) $('ytBtn').href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
}
let origNode = null, origReady = null, origSeq = 0, origDuration = 0, origSeeking = false;
function ensureOrig() {
  return (origReady ??= (async () => {
    await ensureAudio();
    await ctx.audioWorklet.addModule('js/original-worklet.bundle.js?v=' + APP_VERSION);
    origNode = new AudioWorkletNode(ctx, 'libvgm-player', { outputChannelCount: [2] });
    origNode.connect(gain);
    origNode.port.onmessage = (e) => onOrigStatus(e.data);
  })().catch((e) => { origReady = null; throw e; }));
}
function onOrigStatus(m) {
  if (m.id !== undefined && m.id !== origSeq) return;
  if (m.type === 'loaded') {
    origDuration = m.duration;
    $('origChips').textContent = '元の音源チップ: ' + m.chips.join(' ・ ');
  } else if (m.type === 'error') {
    $('origInfo').textContent = '再生できませんでした: ' + m.message;
  } else if (m.type === 'status') {
    const d = m.duration || origDuration;
    $('origTime').textContent = `${fmt(Math.min(m.time, d || m.time))} / ${fmt(d)}`;
    if (!origSeeking && d) $('origSeek').value = Math.round(m.time / d * 1000);
    $('origPlay').textContent = m.playing ? '❚❚ 一時停止' : '▶ 再生';
  }
}
function openOrig() {
  if (!state.origVgm && !state.songId) return;
  if (state.playing) { post({ type: 'pause' }); setPlaying(false); }
  $('origPanel').hidden = false;
  $('origBtn').textContent = '🔁 変換した音に戻る';
  const native = !!state.origVgm;
  $('origPanel').classList.toggle('native', native);
  $('origNative').hidden = !native;
  $('origFrame').hidden = native;
  if (native) {
    $('origInfo').textContent = 'libvgm (chiptune.app と同じエミュレーター) でページ内再生';
    $('origChips').textContent = '読み込み中…';
    $('origTime').textContent = '0:00 / 0:00'; $('origSeek').value = 0;
    const id = ++origSeq, data = state.origVgm.slice(0);
    ensureOrig().then(() => origNode.port.postMessage({ type: 'load', id, data, play: true }, [data]))
      .catch((e) => { $('origInfo').textContent = '元の音源を準備できませんでした (' + (e && e.message || e) + ')'; });
  } else {
    $('origInfo').textContent = 'chiptune.app の再生画面。始まらない時は ▶ を押してください';
    $('origFrame').src = 'https://chiptune.app/?play=' + encodeURIComponent(state.songId);
  }
  $('origPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function closeOrig() {
  if ($('origPanel').hidden) return;
  if (origNode) origNode.port.postMessage({ type: 'pause' });
  $('origFrame').src = 'about:blank'; // 元の音を止める
  $('origPanel').hidden = true;
  $('origBtn').textContent = '🎵 元の音源で聴く';
}
$('origPlay').onclick = () => {
  if (!origNode) return;
  const playing = $('origPlay').textContent.startsWith('❚❚');
  origNode.port.postMessage({ type: playing ? 'pause' : 'play' });
  $('origPlay').textContent = playing ? '▶ 再生' : '❚❚ 一時停止';
};
$('origSeek').oninput = () => { origSeeking = true; };
$('origSeek').onchange = () => { origSeeking = false; if (origNode && origDuration) origNode.port.postMessage({ type: 'seek', time: $('origSeek').value / 1000 * origDuration }); };
// VGM を読み込んだ時: 元の音源ボタンを有効に (chiptune.app に無い曲・PCM だけの基板でも元の音は聴ける)
function enableOrigVgm(raw) {
  state.origVgm = raw;
  $('origBtn').disabled = false;
  $('origBtn').title = '元の基板・機種の音源でページ内再生します (libvgm)';
}
$('origBtn').onclick = () => ($('origPanel').hidden ? openOrig() : closeOrig());
$('origClose').onclick = closeOrig;

// ---------- VGM (アーケード基板などの音源チップ命令の記録) ----------
async function loadVGM(buf, name, sub) {
  let src;
  let raw;
  try { raw = await unpackVGM(buf); src = parseVGM(raw); } catch (e) { $('songSub').textContent = '読み込めませんでした: ' + e.message; return false; }
  enableOrigVgm(raw);
  const nv = src.voices.length;
  let active = 0;
  for (let i = 0; i < src.count * nv; i++) if (src.data[i * 3 + 2] & 1) { active++; break; }
  if (!active && !src.hits.length) {
    $('songTitle').textContent = name.replace(/\.vg[mz]$/i, '');
    $('songSub').textContent = `この曲は音程を読み取れる音源を使っていません (${[...src.chips, ...src.unsupported].join(' / ') || '不明'})。PCM だけで鳴らす基板は別の音源に差し替えられませんが、「元の音源で聴く」で元の音は聴けます`;
    return false;
  }
  state.song = { reg: src, duration: src.duration };
  state.mutes.fill(false); state.tones.fill(null);
  $('songTitle').textContent = name.replace(/\.vg[mz]$/i, '');
  const chipsTxt = '元の音源: ' + src.chips.join(' + ') + (src.unsupported.length ? ` (${src.unsupported.join('・')} は鳴らせません)` : '');
  $('songSub').textContent = [sub, chipsTxt].filter(Boolean).join(' ・ ');
  for (const id of ['playBtn', 'stopBtn', 'seek', 'exportBtn']) $(id).disabled = false;
  updateVgmBtn();
  renderParts();
  try { await ensureAudio(); } catch { return false; }
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
  try { await ensureAudio(); } catch { return false; }
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
    return await loadSong(await r.arrayBuffer(), parts.pop(), parts.join(' / '), path, songId);
  } catch (e) { $('songSub').textContent = 'ダウンロード失敗: ' + e.message; return false; }
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

const parentOf = (p) => p.replace(/\/[^/]+$/, '') || '/';
async function browse(path) {
  $('upBtn').hidden = path === '/';
  $('upBtn').onclick = () => browse(parentOf(path));
  state.path = path;
  renderCrumbs();
  const ul = $('list');
  ul.innerHTML = '<li class="msg">読み込み中…</li>';
  try {
    const items = (await apiFetch(`${API}/browse?path=${encodeURIComponent(path)}`)) || (await catalogBrowse(path));
    ul.innerHTML = '';
    if (useCatalog && path === '/') { const n = document.createElement('li'); n.className = 'msg'; n.textContent = catalogNote(); ul.append(n); }
    // ルートでは MIDI を含むフォルダを先頭に
    if (path === '/') items.sort((a, b) => (/midi|project ay|vgm rips/i.test(b.path) - /midi|project ay|vgm rips/i.test(a.path)));
    const queue = items.filter((it) => it.type !== 'directory' && isMidi(it.path)).map((it) => ({ file: it.path, songId: it.songId || null }));
    for (const it of items) {
      const name = it.path.split('/').pop();
      if (it.type === 'directory') addItem('📁 ' + name, () => browse('/' + it.path), it.count + '曲');
      else addItem('♪ ' + name, isMidi(name) ? () => playQueue(queue, queue.findIndex((q) => q.file === it.path)) : null, null, it.path);
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
function markCurrent() { for (const li of document.querySelectorAll('.list li')) li.classList.toggle('cur', !!li.dataset.file && li.dataset.file === state.curFile); }

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
  $('upBtn').hidden = false; $('upBtn').onclick = () => browse(state.path);
  $('crumbs').textContent = `検索: "${q}" (MIDI・ZX のみ)`;
  try {
    if (useCatalog) $('crumbs').textContent += ' ・ 曲リストを読み込み中…';
    const res = await apiFetch(`${API}/search?query=${encodeURIComponent(q)}&limit=500`);
    const items = (res ? res.items : await catalogSearch(q)).filter((it) => isMidi(it.file));
    $('crumbs').textContent = `検索: "${q}" (MIDI・ZX のみ) ${catalogNote()}`;
    ul.innerHTML = '';
    addItem('📁 フォルダ表示に戻る', () => browse(state.path));
    if (!items.length) addItem('見つかりませんでした', null);
    const queue = items.map((it) => ({ file: it.file, songId: it.song_id || null }));
    let lastDir = null;
    items.forEach((it, i) => {
      const parts = it.file.split('/');
      const dir = parts.slice(0, -1).join('/');
      if (dir !== lastDir) {
        lastDir = dir;
        const h = document.createElement('li');
        h.className = 'group'; h.textContent = '🎮 ' + parts.at(-2); h.title = dir;
        h.onclick = () => openGameByPath('/' + dir);
        $('list').append(h);
      }
      addItem('　♪ ' + parts.at(-1), () => playQueue(queue, i), null, it.file);
    });
    markCurrent();
  } catch (err) { msg(`検索できませんでした (${err.message})`); }
};

// ---------- ローカルファイル ----------
const drop = $('drop');
$('fileInput').onchange = (e) => readLocal(e.target.files[0]);
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); readLocal(e.dataTransfer.files[0]); };
async function readLocal(f) { if (f) { ensureAudio().catch(() => {}); state.curFile = null; state.queue = []; state.qi = -1; updateQueueBtns(); await loadSong(await f.arrayBuffer(), f.name, 'ローカルファイル'); } }
$('urlForm').onsubmit = async (e) => {
  e.preventDefault();
  const url = $('urlInput').value.trim(); if (!url) return;
  try {
    const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
    await loadSong(await r.arrayBuffer(), decodeURIComponent(url.split('/').pop()), url);
  } catch (err) { alert('取得できませんでした: ' + err.message); }
};

function selectTab(name) {
  document.querySelectorAll('.tabs .tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  for (const id of ['games', 'browse', 'local']) $('tab-' + id).classList.toggle('hidden', id !== name);
  if (name === 'browse' && !$('list').children.length) browse('/');
}
document.querySelectorAll('.tabs .tab').forEach((t) => t.onclick = () => selectTab(t.dataset.tab));

// ---------- 再生リスト (前の曲・次の曲・連続再生) ----------
state.queue = []; state.qi = -1;
async function playQueue(queue, i, auto = false) {
  if (!queue[i]) return;
  ensureAudio().catch(() => {}); // タップした瞬間に音声を開始 (スマホでは後からだと鳴らないことがある)
  state.queue = queue; state.qi = i;
  updateQueueBtns();
  const ok = await loadRemote(queue[i].file, queue[i].songId);
  // 連続再生中に鳴らせない曲 (PCM だけの基板など) は飛ばす
  if (ok === false && auto) setTimeout(() => playNext(1, true), 800);
}
function playNext(d, auto = false) {
  const i = state.qi + d;
  if (i < 0 || i >= state.queue.length) return false;
  playQueue(state.queue, i, auto);
  return true;
}
function updateQueueBtns() {
  $('prevBtn').disabled = state.qi <= 0;
  $('nextBtn').disabled = state.qi < 0 || state.qi >= state.queue.length - 1;
}
$('prevBtn').onclick = () => playNext(-1);
$('nextBtn').onclick = () => playNext(1);

// ---------- ゲーム別 (VGM Rips / Arcade) ----------
const GAME_ROOT = '/VGM Rips/Arcade';
let games = null;
const splitTitle = (n) => { const m = n.match(/^(.*?)\s*\(([^()]*)\)\s*$/); return m ? { title: m[1], sys: m[2] } : { title: n, sys: '' }; };
const letterOf = (t) => { const c = (t[0] || '#').toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; };
function trackFiles(dirs, path) {
  const out = [];
  for (const e of dirs[path] || []) {
    if (typeof e[1] === 'number') out.push(...trackFiles(dirs, path + '/' + e[0]));
    else out.push({ file: path.slice(1) + '/' + e[0], songId: e[1] || null, label: e[0].replace(/\.(vg[mz]|midi?|kar|rmi)$/i, '') });
  }
  return out;
}
// シリーズ (家庭用版も含めて探せるように)
const SERIES = [{ id: 'gradius', label: 'グラディウス シリーズ', re: /gradius|nemesis|salamander|life force|parodius|gofer/i }];
const PLATFORM = { 'Sharp X68000': 'X68000版', 'NEC PC-88': 'PC-88版', 'Sharp X1': 'X1版', MSX: 'MSX版', 'NEC TurboGrafx 16': 'PCエンジン版', 'Nintendo NES': 'ファミコン版', 'Nintendo GameBoy': 'ゲームボーイ版' };
const MAKERS = ['Capcom', 'Konami', 'Namco', 'Sega', 'Taito'];
let gameScope = 'all';
async function loadGames() {
  if (games) return games;
  const dirs = await catTop('VGM Rips');
  const isDir = (e) => typeof e[1] === 'number';
  const make = (path, name, count, extra) => {
    const t = splitTitle(name);
    const g = { path, name, count, title: t.title, sys: t.sys, maker: '', platform: '', top: 'VGM Rips', ...extra };
    g.series = (SERIES.find((s) => s.re.test(name)) || {}).id || '';
    g.label = [g.maker, g.platform, g.sys].filter(Boolean).join(' ・ ');
    g.search = [name, g.maker, g.platform, g.series === 'gradius' ? 'グラディウス gradius' : ''].join(' ').toLowerCase();
    return g;
  };
  games = [];
  // アーケード: メーカー別フォルダ (Capcom / Konami など) は中のゲームを 1 作品ずつ
  for (const e of dirs[GAME_ROOT] || []) {
    if (!isDir(e)) continue;
    const p = GAME_ROOT + '/' + e[0];
    const sub = (dirs[p] || []).filter(isDir);
    if (sub.length) for (const s of sub) games.push(make(p + '/' + s[0], s[0], s[1], { maker: e[0] }));
    else games.push(make(p, e[0], e[1], {}));
  }
  // 家庭用版 (グラディウス シリーズなど)
  for (const [plat, label] of Object.entries(PLATFORM)) {
    for (const e of dirs['/VGM Rips/' + plat] || []) if (isDir(e)) games.push(make('/VGM Rips/' + plat + '/' + e[0], e[0], e[1], { platform: label, home: true }));
  }
  // アーケード版の MIDI (アーケード版グラディウスなど、VGM が無いもの)
  const MIDI_GAMES = [
    ['Sound Canvas MIDI Collection', '/Sound Canvas MIDI Collection/Konami/Gradius', 'アーケード版 MIDI (Sound Canvas)'],
    ['vgmusic.com MIDI', '/vgmusic.com MIDI/Arcade/Gradius II - Gofer No Yabou', 'アーケード版 MIDI'],
    ['vgmusic.com MIDI', '/vgmusic.com MIDI/Arcade/Gradius III', 'アーケード版 MIDI'],
    ['vgmusic.com MIDI', '/vgmusic.com MIDI/Arcade/Life Force (Japan)', 'アーケード版 MIDI'],
    ['vgmusic.com MIDI', '/vgmusic.com MIDI/Arcade/Nemesis 2 - Vulcan Venture', 'アーケード版 MIDI'],
    ['vgmusic.com MIDI', '/vgmusic.com MIDI/Arcade/Salamander', 'アーケード版 MIDI'],
    ['Sound Canvas MIDI Collection', '/Sound Canvas MIDI Collection/Konami/Life Force', 'アーケード版 MIDI (Sound Canvas)'],
    ['Sound Canvas MIDI Collection', '/Sound Canvas MIDI Collection/Konami/Salamander 2', 'アーケード版 MIDI (Sound Canvas)'],
    ['Game MIDI', '/Game MIDI/- Arranged -/Gradius (NES∕C64, 1986)', 'アレンジ MIDI'],
  ];
  for (const [top, path, label] of MIDI_GAMES) {
    try {
      const d = await catTop(top);
      const n = (d[path] || []).filter((e) => !isDir(e)).length;
      const name = path.split('/').pop().replace(/\s*\(.*\)$/, '');
      if (n) games.push(make(path, name, n, { platform: label, home: true, top, midi: true }));
    } catch {}
  }
  games.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.label.localeCompare(b.label));
  return games;
}
function renderScopes(gs) {
  const box = $('gameScopes'); box.innerHTML = '';
  const scopes = [['all', 'すべて'], ...SERIES.map((s) => ['series:' + s.id, s.label]), ...MAKERS.map((m) => ['maker:' + m, m])];
  // 「1つ上へ」で入った機種・アーケードのまとまりも、選択中のボタンとして出す
  if (!scopes.some(([id]) => id === gameScope)) scopes.push([gameScope, scopeLabel(gameScope)]);
  for (const [id, label] of scopes) {
    const b = document.createElement('button');
    b.className = 'tab' + (gameScope === id ? ' active' : ''); b.textContent = label;
    b.onclick = () => { gameScope = id; showGames(); };
    box.append(b);
  }
}
function scopeLabel(id) {
  const [kind, val] = id.split(':');
  return kind === 'platform' ? val : kind === 'arcade' ? 'アーケード (メーカー別以外)' : kind === 'maker' ? val : id;
}
// ゲームの 1 つ上のまとまり: メーカー別フォルダ → そのメーカー、家庭用版・MIDI → その機種・種類、それ以外 → アーケード
const parentScope = (g) => (g.maker ? 'maker:' + g.maker : g.platform ? 'platform:' + g.platform : 'arcade');
function gameMsg(text) { const ul = $('gameList'); ul.innerHTML = ''; const li = document.createElement('li'); li.className = 'msg'; li.textContent = text; ul.append(li); }
let lastGame = null;
async function showGames(restore = false) {
  $('gameHead').hidden = true; $('gameIndex').hidden = false;
  let gs;
  try { gs = await loadGames(); } catch (e) { return gameMsg('ゲーム一覧を読み込めませんでした (' + e.message + ')'); }
  renderScopes(gs);
  const q = $('gameFilter').value.trim().toLowerCase();
  const [kind, val] = gameScope.split(':');
  const inScope = (g) => (kind === 'series' ? g.series === val : kind === 'maker' ? g.maker === val : kind === 'platform' ? g.platform === val : kind === 'arcade' ? !g.home && !g.maker : true);
  const shown = gs.filter((g) => inScope(g) && (!q || g.search.includes(q)));
  const arcade = gs.filter((g) => !g.home).length;
  $('gameCount').textContent = q || gameScope !== 'all'
    ? `${shown.length} 作品・${shown.reduce((n, g) => n + g.count, 0).toLocaleString()} 曲`
    : `アーケード ${arcade} 作品 + 家庭用版・MIDI ${gs.length - arcade} 作品・${gs.reduce((n, g) => n + g.count, 0).toLocaleString()} 曲`;
  const ul = $('gameList'); ul.innerHTML = '';
  const letters = new Set();
  let last = '';
  for (const g of shown) {
    const L = letterOf(g.title);
    if (L !== last) { const h = document.createElement('li'); h.className = 'letter'; h.textContent = L; h.dataset.letter = L; ul.append(h); last = L; letters.add(L); }
    const li = document.createElement('li');
    const t = document.createElement('span'); t.textContent = g.title; li.append(t);
    if (g.label) { const sy = document.createElement('span'); sy.className = 'sys'; sy.textContent = g.label; li.append(sy); }
    const n = document.createElement('span'); n.className = 'n'; n.textContent = g.count + '曲'; li.append(n);
    li.title = g.path.slice(1); li.onclick = () => showGame(g);
    if (restore && g === lastGame) li.classList.add('last-game');
    ul.append(li);
  }
  if (!shown.length) gameMsg('該当するゲームはありません');
  ul.scrollTop = 0;
  const lastLi = restore && ul.querySelector('li.last-game');
  if (lastLi) ul.scrollTop += lastLi.getBoundingClientRect().top - ul.getBoundingClientRect().top - ul.clientHeight / 3;
  const bar = $('gameLetters'); bar.innerHTML = '';
  for (const L of ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
    const b = document.createElement('button');
    b.textContent = L; b.disabled = !letters.has(L);
    b.onclick = () => { const h = ul.querySelector(`[data-letter="${L}"]`); if (h) ul.scrollTop += h.getBoundingClientRect().top - ul.getBoundingClientRect().top; };
    bar.append(b);
  }
}
async function showGame(g) {
  lastGame = g;
  $('gameUp').textContent = '▲ 1つ上へ (' + scopeLabel(parentScope(g)) + ')';
  $('gameUp').onclick = () => { gameScope = parentScope(g); $('gameFilter').value = ''; showGames(true); };
  $('gameFolder').onclick = () => { selectTab('browse'); browse(parentOf(g.path)); };
  $('gameIndex').hidden = true; $('gameHead').hidden = false;
  $('gameTitle').textContent = g.title;
  $('gameSys').textContent = [g.label, g.count + '曲'].filter(Boolean).join(' ・ ');
  const dirs = await catTop(g.top || 'VGM Rips');
  const tracks = trackFiles(dirs, g.path);
  const ul = $('gameList'); ul.innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.textContent = '♪ ' + t.label; li.title = t.label; li.dataset.file = t.file;
    li.onclick = () => playQueue(tracks, i);
    ul.append(li);
  });
  $('gamePlayAll').onclick = () => playQueue(tracks, 0);
  ul.scrollTop = 0;
  markCurrent();
}
async function openGameByPath(dir) {
  const g = (await loadGames()).find((x) => dir === x.path || dir.startsWith(x.path + '/'));
  if (!g) return browse(dir);
  selectTab('games');
  showGame(g);
}
// 一覧に戻る: 絞り込みを外して全ゲームの一覧へ (見ていたゲームの位置)
function backToList() { gameScope = 'all'; $('gameFilter').value = ''; showGames(true); }
$('gameBack').onclick = backToList;
$('folderToList').onclick = () => { selectTab('games'); backToList(); };
$('gameFilter').oninput = () => showGames();

// ---------- 再生コントロール ----------
$('playBtn').onclick = async () => {
  closeOrig();
  try { await ensureAudio(); } catch { return; }
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
  const w = new Worker('js/export-worker.js?v=' + APP_VERSION, { type: 'module' });
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
showGames();
function msg(text) { const ul = $('list'); ul.innerHTML = ''; const li = document.createElement('li'); li.className = 'msg'; li.textContent = text; ul.append(li); }
