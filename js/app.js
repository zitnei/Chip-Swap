import { parseMidi, GM_NAMES } from './midi.js';
import { CHIPS, TONES } from './chips.js';
import { VGM_SUPPORTED } from './vgm.js';
import { isAY, parseAY, runAY } from './ay.js';
import { isVGM, unpackVGM, parseVGM } from './vgmin.js';
import { analyzeVGMs, buildToneSet } from './instruments.js';
import { isSPC, spcToReg, spcTags, loadSpcCore } from './spc.js';

// chiptune.app の API と曲ファイルは chiptune.app と localhost からしか読めない。
// それ以外 (GitHub Pages の公開ページ) では Cloudflare Workers の中継 (proxy/worker.js) を通す。
const APP_VERSION = '20261110n'; // 更新したら index.html の ?v= と一緒に変える
const PROXY = 'https://chip-swap-proxy.zitnei.workers.dev';
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// (API は下の PROXY が決まってから設定)
const FILES = LOCAL ? 'https://gifx.co/music/' : PROXY + '/music/';
const API = LOCAL ? 'https://chiptune.app/api' : PROXY + '/api';
const $ = (id) => document.getElementById(id);
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => NOTE[n % 12] + (Math.floor(n / 12) - 1);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const isMidi = (p) => /\.(mid|midi|kar|rmi|ay|vgm|vgz|spc)$/i.test(p);
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
  if (tg.active) post({ type: 'toneset', tones: tg.active.set.tones, map: tg.active.set.map });
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
  if (isSPC(buf)) return loadSPC(buf, name, sub);
  let song;
  try { song = parseMidi(buf); } catch (e) { alert('読み込めませんでした: ' + e.message); return; }
  if (!song.events.some((e) => e.type === 'on')) { alert('ノートが入っていない MIDI です'); return; }
  state.song = song;
  setOrigBtn(true, 'chiptune.app と同じ MIDI 音源 (FluidLite + SoundFont) でページ内再生します');
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
// すべてページ内で鳴らす (chiptune.app の画面は使わない)。
//  VGM: libvgm (chiptune.app と同じエミュレーター) で元の基板の音源のまま
//  MIDI: FluidLite + chiptune.app と同じ SoundFont (曲ごとの指定があればそれ、無ければ GMGSx Plus)
//  ZX チューン: 元の音源 (ZXスペクトラムの AY-3-8912) に切り替える
const SF_BASE = LOCAL ? 'https://gifx.co/soundfonts/' : PROXY + '/soundfonts/';
const META_API = LOCAL ? API + '/metadata' : PROXY + '/api/metadata';
const DEFAULT_SF = 'gmgsx-plus.sf2';
function setOrigLink(songId) {
  state.songId = songId || null;
  state.origVgm = null;
  state.origSpc = null;
  closeOrig();
  setOrigBtn(false);
  // YouTube 検索: ゲーム名 + 曲名
  const parts = (state.curFile || '').split('/');
  const game = parts.length > 1 ? splitTitle(parts.at(-2)).title : '';
  const track = (parts.at(-1) || '').replace(/\.[^.]+$/, '').replace(/^\d+\s*/, '');
  const q = [game, track].filter(Boolean).join(' ');
  $('ytBtn').hidden = !q;
  if (q) $('ytBtn').href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
}
function setOrigBtn(on, title) {
  $('origBtn').disabled = !on;
  $('origBtn').title = on ? title : 'この曲は元の音源で聴けません';
}
const ORIG_ENGINES = {
  spc: { file: 'js/original-spc-worklet.bundle.js', proc: 'spc-player' },
  vgm: { file: 'js/original-worklet.bundle.js', proc: 'libvgm-player' },
  midi: { file: 'js/original-midi-worklet.bundle.js', proc: 'fluid-player' },
};
const orig = { node: {}, ready: {}, seq: 0, duration: 0, seeking: false, kind: null, sfLoaded: null };
const origNode = () => orig.node[orig.kind];
function ensureOrig(kind) {
  return (orig.ready[kind] ??= (async () => {
    await ensureAudio();
    await ctx.audioWorklet.addModule(ORIG_ENGINES[kind].file + '?v=' + APP_VERSION);
    const n = new AudioWorkletNode(ctx, ORIG_ENGINES[kind].proc, { outputChannelCount: [2] });
    n.connect(gain);
    n.port.onmessage = (e) => onOrigStatus(kind, e.data);
    orig.node[kind] = n;
  })().catch((e) => { orig.ready[kind] = null; throw e; }));
}
// MIDI の SoundFont: chiptune.app の曲情報に指定があればそれ、無ければ既定 (GMGSx Plus)
async function soundfontFor(path) {
  if (path) {
    try {
      const m = await fetch(META_API + '?path=' + encodeURIComponent(path)).then((r) => r.json());
      if (m && m.soundfont) return { name: m.soundfont.split('/').pop(), url: FILES + enc(m.soundfont) };
    } catch {}
  }
  return { name: 'GMGSx Plus', url: SF_BASE + DEFAULT_SF };
}
function onOrigStatus(kind, m) {
  if (kind !== orig.kind || (m.id !== undefined && m.id !== orig.seq)) return;
  if (m.type === 'loaded') {
    orig.duration = m.duration;
    if (m.chips) $('origChips').textContent = '元の音源チップ: ' + m.chips.join(' ・ ');
  } else if (m.type === 'soundfont') {
    $('origChips').textContent = m.ok ? `MIDI 音源: FluidLite + SoundFont「${m.name}」(chiptune.app と同じ)` : '音色データを読み込めませんでした';
  } else if (m.type === 'error') {
    $('origInfo').textContent = '再生できませんでした: ' + m.message;
  } else if (m.type === 'status') {
    const d = m.duration || orig.duration;
    $('origTime').textContent = `${fmt(Math.min(m.time, d || m.time))} / ${fmt(d)}`;
    if (!orig.seeking && d) $('origSeek').value = Math.round(m.time / d * 1000);
    $('origPlay').textContent = m.playing ? '❚❚ 一時停止' : '▶ 再生';
  }
}
function openOrig() {
  // ZX チューン: 元の音源は AY-3-8912 なので、その音源に切り替えて鳴らす
  if (state.song && state.song.zx) {
    selectChip('zx128');
    if (!state.playing) { post({ type: 'play' }); setPlaying(true); }
    return;
  }
  const kind = state.origSpc ? 'spc' : state.origVgm ? 'vgm' : state.song && state.song.events ? 'midi' : null;
  if (!kind) return;
  if (state.playing) { post({ type: 'pause' }); setPlaying(false); }
  for (const k in orig.node) if (k !== kind) orig.node[k].port.postMessage({ type: 'pause' });
  orig.kind = kind;
  const id = ++orig.seq;
  $('origPanel').hidden = false;
  $('origBtn').textContent = '🔁 変換した音に戻る';
  $('origTime').textContent = '0:00 / 0:00'; $('origSeek').value = 0;
  $('origChips').textContent = '読み込み中…';
  const fail = (e) => { $('origInfo').textContent = '元の音源を準備できませんでした (' + (e && e.message || e) + ')'; };
  if (kind === 'spc') {
    $('origInfo').textContent = 'SPC エミュレーター (game-music-emu / snes_spc) でページ内再生';
    const t = state.origSpc.tags, data = state.origSpc.buf.slice(0);
    ensureOrig('spc').then(() => orig.node.spc.port.postMessage({ type: 'load', id, data, seconds: t.seconds || 180, fadeMs: t.fadeMs || 0, play: true }, [data])).catch(fail);
  } else if (kind === 'vgm') {
    $('origInfo').textContent = 'libvgm (chiptune.app と同じエミュレーター) でページ内再生';
    const data = state.origVgm.slice(0);
    ensureOrig('vgm').then(() => orig.node.vgm.port.postMessage({ type: 'load', id, data, play: true }, [data])).catch(fail);
  } else {
    $('origInfo').textContent = 'chiptune.app と同じ MIDI 音源 (FluidLite + SoundFont) でページ内再生';
    const song = state.song, path = state.curFile;
    ensureOrig('midi').then(async () => {
      const sf = await soundfontFor(path);
      if (orig.sfLoaded !== sf.url) {
        $('origChips').textContent = `音色データ「${sf.name}」を読み込み中… (初回のみ数MB)`;
        const r = await fetch(sf.url);
        if (!r.ok) throw new Error('音色データを取得できませんでした (HTTP ' + r.status + ')');
        const data = await r.arrayBuffer();
        if (id !== orig.seq) return;
        orig.node.midi.port.postMessage({ type: 'soundfont', data, name: sf.name }, [data]);
        orig.sfLoaded = sf.url;
      } else $('origChips').textContent = `MIDI 音源: FluidLite + SoundFont「${sf.name}」(chiptune.app と同じ)`;
      if (id !== orig.seq) return;
      orig.node.midi.port.postMessage({ type: 'load', id, events: song.events, duration: song.duration, play: true });
    }).catch(fail);
  }
  $('origPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function closeOrig() {
  if ($('origPanel').hidden) return;
  for (const k in orig.node) orig.node[k].port.postMessage({ type: 'pause' });
  orig.seq++; // 読み込み途中のものは捨てる
  $('origPanel').hidden = true;
  $('origBtn').textContent = '🎵 元の音源で聴く';
}
$('origPlay').onclick = () => {
  const n = origNode();
  if (!n) return;
  const playing = $('origPlay').textContent.startsWith('❚❚');
  n.port.postMessage({ type: playing ? 'pause' : 'play' });
  $('origPlay').textContent = playing ? '▶ 再生' : '❚❚ 一時停止';
};
$('origSeek').oninput = () => { orig.seeking = true; };
$('origSeek').onchange = () => {
  orig.seeking = false;
  const n = origNode();
  if (n && orig.duration) n.port.postMessage({ type: 'seek', time: $('origSeek').value / 1000 * orig.duration });
};
// VGM を読み込んだ時: 元の音源ボタンを有効に (chiptune.app に無い曲・PCM だけの基板でも元の音は聴ける)
function enableOrigVgm(raw) {
  state.origVgm = raw;
  setOrigBtn(true, '元の基板・機種の音源でページ内再生します (libvgm)');
}
$('origBtn').onclick = () => ($('origPanel').hidden ? openOrig() : closeOrig());
$('origClose').onclick = closeOrig;

// ---------- SPC (スーパーファミコン) ----------
// SPC エミュレーターを動かして 8 チャンネルの音程・音量・発音を読み取り、選んだ音源で鳴らし直す
async function loadSPC(buf, name, sub) {
  const tags = spcTags(buf);
  $('songTitle').textContent = tags.title || name.replace(/\.spc$/i, '');
  $('songSub').textContent = 'スーパーファミコンの曲を読み取り中…';
  let src;
  try {
    const M = await loadSpcCore('js/vendor/snesspc.js?v=' + APP_VERSION);
    await new Promise((r) => setTimeout(r, 30)); // 表示を更新してから重い処理
    src = spcToReg(M, buf);
  } catch (e) { $('songSub').textContent = '読み込めませんでした: ' + e.message; return false; }
  state.song = { reg: src, duration: src.duration };
  state.origSpc = { buf, tags };
  setOrigBtn(true, '元のスーパーファミコンの音でページ内再生します (SPC エミュレーター)');
  state.mutes.fill(false); state.tones.fill(null);
  $('songSub').textContent = [tags.game, tags.artist, sub, '元の音源: スーパーファミコン (SPC700 / S-DSP)'].filter(Boolean).join(' ・ ');
  for (const id of ['playBtn', 'stopBtn', 'seek', 'exportBtn']) $(id).disabled = false;
  updateVgmBtn();
  renderParts();
  try { await ensureAudio(); } catch { return false; }
  post({ type: 'mutes', value: state.mutes });
  post({ type: 'tones', value: state.tones });
  post(loadMsg());
  post({ type: 'play' }); setPlaying(true);
}

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
  setOrigBtn(true, '元の音源 (ZXスペクトラムの AY-3-8912) に切り替えます');
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
let useCatalog = null; // まず chiptune.app の一覧 (公開ページは中継経由)、使えなければ同梱リスト
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
    if (path === '/') items.sort((a, b) => (/midi|project ay|vgm rips|nintendo snes/i.test(b.path) - /midi|project ay|vgm rips|nintendo snes/i.test(a.path)));
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
// ゲーム機: chiptune.app の一覧から、ボタンを押したときに 1 回だけ読む (公開ページは中継経由)
const CONSOLES = [
  { name: 'ファミコン', path: '/VGM Rips/Nintendo NES', en: 'nes famicom' },
  { name: 'スーパーファミコン', path: '/Nintendo SNES', en: 'snes super famicom spc', spc: true },
  { name: 'ゲームボーイ', path: '/VGM Rips/Nintendo GameBoy', en: 'gameboy' },
  { name: 'メガドライブ', path: '/Sega Genesis', en: 'genesis mega drive' },
  { name: 'マスターシステム', path: '/Sega Master System', en: 'master system mark iii' },
  { name: 'ゲームギア', path: '/Sega Game Gear', en: 'game gear' },
  { name: 'PCエンジン', path: '/VGM Rips/NEC TurboGrafx 16', en: 'pc engine turbografx' },
  { name: 'ネオジオ', path: '/VGM Rips/SNK Neo Geo', en: 'neo geo' },
  { name: 'MSX', path: '/VGM Rips/MSX', en: 'msx' },
  { name: 'PC-88', path: '/VGM Rips/NEC PC-88', en: 'pc-88 pc88' },
  { name: 'PC-98', path: '/VGM Rips/NEC PC-98', en: 'pc-98 pc98' },
  { name: 'X68000', path: '/VGM Rips/Sharp X68000', en: 'x68000 x68k' },
  { name: 'X1', path: '/VGM Rips/Sharp X1', en: 'x1' },
  { name: 'FM TOWNS', path: '/VGM Rips/Fujitsu FM Towns', en: 'fm towns' },
  { name: 'PC (DOS)', path: '/VGM Rips/PC DOS', en: 'pc dos adlib' },
];
const consoleOf = (scope) => CONSOLES.find((c) => 'platform:' + c.name + '版' === scope);
const consoleLoad = {};
function makeGame(path, name, count, extra) {
  const t = splitTitle(name);
  const g = { path, name, count, title: t.title, sys: t.sys, maker: '', platform: '', top: 'VGM Rips', ...extra };
  g.series = (SERIES.find((s) => s.re.test(name)) || {}).id || '';
  g.label = [g.maker, g.platform, g.sys].filter(Boolean).join(' ・ ');
  g.search = [name, g.maker, g.platform, g.en || '', g.series === 'gradius' ? 'グラディウス gradius' : ''].join(' ').toLowerCase();
  return g;
}
const sortGames = (gs) => gs.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.label.localeCompare(b.label));
// ゲーム機のゲーム一覧を読み込んで games に加える
function loadConsole(c) {
  return (consoleLoad[c.path] ??= (async () => {
    await loadGames();
    const items = await apiFetch(`${API}/browse?path=${encodeURIComponent(c.path)}`);
    if (!items) throw new Error('chiptune.app の一覧を読めませんでした');
    const have = new Set(games.map((g) => g.path));
    for (const it of items) {
      const p = '/' + it.path;
      if (it.type !== 'directory' || have.has(p)) continue;
      games.push(makeGame(p, it.path.split('/').pop(), it.count, { platform: c.name + '版', en: c.en, home: true, live: true, spc: !!c.spc }));
    }
    sortGames(games);
    c.loaded = true;
  })().catch((e) => { delete consoleLoad[c.path]; throw e; }));
}
// ゲーム機のゲームの曲: フォルダを開いて (中にフォルダがあればその中も) 曲を集める
async function liveTracks(path, depth = 0) {
  const items = (await apiFetch(`${API}/browse?path=${encodeURIComponent(path)}`)) || [];
  const out = [];
  for (const it of items) {
    if (it.type === 'directory') { if (depth < 2) out.push(...(await liveTracks('/' + it.path, depth + 1))); }
    else if (isMidi(it.path)) out.push({ file: it.path, songId: it.songId || null, label: it.path.split('/').pop().replace(/\.(vg[mz]|midi?|kar|rmi|spc|ay)$/i, '') });
  }
  return out;
}
const gameTracks = async (g) => (g.live ? (g.tracks ??= await liveTracks(g.path)) : trackFiles(await catTop(g.top || 'VGM Rips'), g.path));
let gameScope = 'all';
async function loadGames() {
  if (games) return games;
  const dirs = await catTop('VGM Rips');
  const isDir = (e) => typeof e[1] === 'number';
  const make = makeGame;
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
  sortGames(games);
  return games;
}
function renderScopes(gs) {
  const box = $('gameScopes'); box.innerHTML = '';
  const scopes = [['all', 'すべて'], ...SERIES.map((s) => ['series:' + s.id, s.label]), ...MAKERS.map((m) => ['maker:' + m, m])];
  // 「1つ上へ」で入った機種・アーケードのまとまりも、選択中のボタンとして出す
  const cons = CONSOLES.map((c) => ['platform:' + c.name + '版', c.name]);
  if (![...scopes, ...cons].some(([id]) => id === gameScope)) scopes.push([gameScope, scopeLabel(gameScope)]);
  addScopeButtons(box, scopes, gameScope, (id) => { gameScope = id; showGames(); });
  const h = document.createElement('div'); h.className = 'scope-head'; h.textContent = '🎮 ゲーム機 (押すと一覧を読み込みます)'; box.append(h);
  addScopeButtons(box, cons, gameScope, (id) => { gameScope = id; showGames(); });
}
function addScopeButtons(box, list, cur, onPick) {
  for (const [id, label] of list) {
    const b = document.createElement('button');
    b.className = 'tab' + (cur === id ? ' active' : ''); b.textContent = label;
    b.onclick = () => onPick(id);
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
  const con = consoleOf(gameScope);
  if (con && !con.loaded) {
    gameMsg(`${con.name}のゲーム一覧を読み込み中…`); $('gameCount').textContent = '';
    try { await loadConsole(con); } catch (e) { return gameMsg(`${con.name}の一覧を読み込めませんでした (${e.message})。少し待ってからもう一度押してください`); }
    if (consoleOf(gameScope) !== con) return;
    gs = games;
  }
  const q = $('gameFilter').value.trim().toLowerCase();
  const [kind, val] = gameScope.split(':');
  const inScope = (g) => (kind === 'series' ? g.series === val : kind === 'maker' ? g.maker === val : kind === 'platform' ? g.platform === val : kind === 'arcade' ? !g.home && !g.maker : true);
  const shown = gs.filter((g) => inScope(g) && (!q || g.search.includes(q)));
  const arcade = gs.filter((g) => !g.home).length;
  $('gameCount').textContent = q || gameScope !== 'all'
    ? `${shown.length} 作品・${shown.reduce((n, g) => n + g.count, 0).toLocaleString()} 曲`
    : `アーケード ${arcade} 作品 + 家庭用版・MIDI ${gs.length - arcade} 作品・${gs.reduce((n, g) => n + g.count, 0).toLocaleString()} 曲 (ゲーム機は下のボタンで追加)`;
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
  if (!shown.length) gameMsg(gameScope === 'all' ? '該当するゲームはありません。ゲーム機のゲームは、下の「ゲーム機」のボタンで機種を選んでから探してください' : '該当するゲームはありません');
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
  gameMsg('曲を読み込み中…');
  let tracks;
  try { tracks = await gameTracks(g); } catch (e) { return gameMsg('曲の一覧を読み込めませんでした (' + e.message + ')'); }
  if (lastGame !== g) return;
  const ul = $('gameList'); ul.innerHTML = '';
  if (!tracks.length) gameMsg('このゲームには再生できる曲がありません');
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
    if (chipFilter.startsWith('cat:') ? c.cat !== chipFilter.slice(4) && c.cat !== 'both' : chipFilter !== 'all' && c.type !== chipFilter) continue;
    const b = document.createElement('button');
    b.className = 'chip' + (c.id === state.chip ? ' active' : '');
    b.innerHTML = `<span class="maker"><b class="type"></b> </span><span class="name"></span><span class="sys"></span><span class="desc"></span>`;
    b.querySelector('.maker').append(c.maker);
    { const ct = document.createElement('span'); ct.className = 'cat'; ct.textContent = c.cat === 'arcade' ? 'アーケード基板' : c.cat === 'console' ? 'ゲーム機' : 'アーケード / ゲーム機'; b.querySelector('.maker').append(ct); }
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
        sel.innerHTML = toneOptions();
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
        sel.innerHTML = toneOptions();
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
      sel.innerHTML = toneOptions();
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
    toneset: tg.active ? { tones: tg.active.set.tones, map: tg.active.set.map } : null,
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

// ---------- ゲームの音色で選ぶ ----------
// 選んだゲームの VGM を数曲読み込み、そのゲームで使われている音色 (FM の設定・波形・パルス幅) を取り出して使う
const tg = { active: null, seq: 0, scope: 'all' };
function toneOptions() {
  const std = Object.entries(TONES).filter(([, t]) => !t.game);
  const game = tg.active ? Object.entries(tg.active.set.tones) : [];
  const opt = ([k, t]) => `<option value="${k}">${t.label.replace(/[<>&"]/g, '')}</option>`;
  return '<option value="">自動</option>' + (game.length ? '<optgroup label="ゲームの音色">' + game.map(opt).join('') + '</optgroup><optgroup label="標準の音色">' : '') + std.map(opt).join('') + (game.length ? '</optgroup>' : '');
}
document.querySelectorAll('#soundMode .mode').forEach((b) => b.onclick = () => {
  document.querySelectorAll('#soundMode .mode').forEach((x) => x.classList.toggle('active', x === b));
  $('chipMode').hidden = b.dataset.mode !== 'chip';
  $('gameMode').hidden = b.dataset.mode !== 'game';
  if (b.dataset.mode === 'game') showToneGames();
});
async function showToneGames() {
  const box = $('tgScopes'); box.innerHTML = '';
  const pick = (id) => { tg.scope = id; showToneGames(); };
  addScopeButtons(box, [['all', 'すべて'], ['arcade', 'アーケード'], ['home', '家庭用'], ...MAKERS.map((m) => ['maker:' + m, m])], tg.scope, pick);
  const h = document.createElement('div'); h.className = 'scope-head'; h.textContent = '🎮 ゲーム機'; box.append(h);
  addScopeButtons(box, CONSOLES.filter((c) => !c.spc).map((c) => ['platform:' + c.name + '版', c.name]), tg.scope, pick);
  const con = consoleOf(tg.scope);
  if (con && !con.loaded) {
    $('tgList').innerHTML = ''; $('tgStatus').textContent = `${con.name}のゲーム一覧を読み込み中…`;
    try { await loadConsole(con); } catch (e) { $('tgStatus').textContent = `${con.name}の一覧を読み込めませんでした (${e.message})`; return; }
    if (consoleOf(tg.scope) !== con) return;
  }
  const gs = (await loadGames()).filter((g) => !g.midi && !g.spc);
  const q = $('tgFilter').value.trim().toLowerCase();
  const [kind, val] = tg.scope.split(':');
  const shown = gs.filter((g) => (kind === 'arcade' ? !g.home : kind === 'home' ? g.home : kind === 'maker' ? g.maker === val : kind === 'platform' ? g.platform === val : true) && (!q || g.search.includes(q)));
  const ul = $('tgList'); ul.innerHTML = '';
  for (const g of shown.slice(0, 300)) {
    const li = document.createElement('li');
    const t = document.createElement('span'); t.textContent = g.title; li.append(t);
    if (g.label) { const sy = document.createElement('span'); sy.className = 'sys'; sy.textContent = g.label; li.append(sy); }
    li.title = 'このゲームの音色を使う'; li.dataset.path = g.path;
    li.onclick = () => applyToneGame(g);
    if (tg.active && tg.active.path === g.path) li.classList.add('cur');
    ul.append(li);
  }
  $('tgStatus').textContent = shown.length > 300 ? `${shown.length} 作品 (上位 300 件を表示。名前で絞り込んでください)` : `${shown.length} 作品`;
}
$('tgFilter').oninput = () => showToneGames();
async function applyToneGame(g) {
  const id = ++tg.seq;
  $('tgStatus').textContent = `「${g.title}」の曲を探しています…`;
  let tracks;
  try { tracks = (await gameTracks(g)).filter((t) => /\.vg[mz]$/i.test(t.file)).slice(0, 6); } catch (e) { $('tgStatus').textContent = '曲の一覧を読み込めませんでした (' + e.message + ')'; return; }
  if (id !== tg.seq) return;
  $('tgStatus').textContent = `「${g.title}」の曲を読み込んで音色を取り出し中… (${tracks.length} 曲)`;
  const bufs = [];
  for (const t of tracks) {
    try { const r = await fetch(FILES + enc(t.file)); if (r.ok) bufs.push(await unpackVGM(await r.arrayBuffer())); } catch {}
    if (id !== tg.seq) return;
  }
  applyToneBuffers(bufs, g.title, g.label, g.path, id);
}
$('tgFile').onchange = async (e) => {
  const files = [...e.target.files]; if (!files.length) return;
  const id = ++tg.seq;
  $('tgStatus').textContent = '音色を取り出し中…';
  const bufs = [];
  for (const f of files) { try { bufs.push(await unpackVGM(await f.arrayBuffer())); } catch {} }
  const title = files[0].name.replace(/\.vg[mz]$/i, '').replace(/^\d+\s*/, '');
  applyToneBuffers(bufs, title, '手持ちのファイル', null, id);
  e.target.value = '';
};
async function applyToneBuffers(bufs, title, sub, path, id) {
  if (id !== tg.seq) return;
  const a = bufs.length ? analyzeVGMs(bufs) : null;
  if (!a || !a.base || !a.instruments.length) {
    $('tgStatus').textContent = `「${title}」からは音色を取り出せませんでした (PCM だけで鳴らす基板などは音色を持っていません)`;
    return;
  }
  const set = buildToneSet(a, id, title);
  Object.assign(TONES, set.tones);
  // ナムコの基板のゲームは、その基板の音源で
  let base = a.base;
  const where = (sub || '') + ' ' + (path || '');
  if (base === 'cps1' && /Namco System 1\b/.test(where)) base = 'namcosys1';
  else if (base === 'cps1' && /Namco System 2\b/.test(where)) base = 'namcosys2';
  else if (base === 'cps1' && /Namco System 86/.test(where)) base = 'namcosys86';
  tg.active = { title, sub, path, chip: a.chip, base, set };
  post({ type: 'toneset', tones: set.tones, map: set.map });
  selectChip(base);
  const chip = CHIPS.find((c) => c.id === base);
  $('tgActiveText').textContent = `🎮「${title}」の音色 (${a.chip}・${set.list.length} 種類) で再生中 → 音源: ${chip.maker} ${chip.name}`;
  $('tgActive').hidden = false;
  if (state.song) renderParts();
  await showToneGames();
  $('tgStatus').textContent = `「${title}」から ${set.list.length} 種類の音色を取り出しました。パートごとの音色も変えられます`;
}
$('tgClear').onclick = () => {
  tg.active = null; tg.seq++;
  post({ type: 'toneset', tones: {}, map: null });
  $('tgActive').hidden = true;
  if (state.song) renderParts();
  if (!$('gameMode').hidden) showToneGames();
};

// ---------- 起動 ----------
try { const saved = localStorage.getItem('chipswap.chip'); if (CHIPS.some((c) => c.id === saved)) state.chip = saved; } catch {}
renderChips();
showGames();
function msg(text) { const ul = $('list'); ul.innerHTML = ''; const li = document.createElement('li'); li.className = 'msg'; li.textContent = text; ul.append(li); }
