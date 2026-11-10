// 自動生成ファイル: tools/build-worklet.mjs で作成。直接編集しないでください。

// ---- chips.js ----
const __m_chips_js = (() => {
// 音色 (GM ファミリーごと) と 音源チップの定義

// env: ソフトウェアエンベロープ (60Hz フレーム単位, サウンドドライバ風)
//   a=アタック, d=ディケイ, s=サスティンレベル, sd=サスティン中の減衰(フレーム時定数), r=リリース
// vib: ディレイビブラート {delay(フレーム), depth(セント), rate(Hz)}
// fm: 4オペFMパッチ。ops = [mul, TL(dB), attack秒, decay秒, sustain(0-1), sustainDecay秒, release秒, detune(セント)]
const TONES = {
  piano: {
    label: 'ピアノ', harm: [1, .6, .35, .25, .15, .1, .05], duty: .25,
    env: { a: 0, d: 30, s: .4, sd: 140, r: 8 },
    fm: { alg: 4, fb: 3, ops: [[1, 22, 0, .9, .25, 3, .3, 0], [1, 0, 0, 1.6, .35, 4, .35, 3], [14, 32, 0, .25, 0, 1, .2, 0], [1, 4, 0, 1.4, .35, 4, .35, -3]] },
  },
  bell: {
    label: 'ベル / 鉄琴', harm: [1, 0, 0, .5, 0, 0, 0, .3, 0, .2], duty: .125,
    env: { a: 0, d: 10, s: .3, sd: 60, r: 20 },
    fm: { alg: 4, fb: 0, ops: [[7, 18, 0, 1.2, .1, 2, .6, 0], [2, 0, 0, 2.5, .2, 4, .8, 0], [3, 20, 0, .8, .1, 2, .6, 0], [1, 4, 0, 2, .25, 4, .8, 0]] },
  },
  organ: {
    label: 'オルガン', harm: [1, .8, 0, .6, 0, .3, 0, .4], duty: .5,
    env: { a: 0, d: 0, s: 1, r: 3 },
    fm: { alg: 7, fb: 3, ops: [[.5, 10, .002, 0, 1, 0, .05, 0], [1, 4, .002, 0, 1, 0, .05, 0], [2, 8, .002, 0, 1, 0, .05, 0], [4, 14, .002, 0, 1, 0, .05, 0]] },
  },
  guitar: {
    label: 'ギター / 撥弦', harm: [1, .7, .5, .4, .3, .2, .15, .1], duty: .25,
    env: { a: 0, d: 20, s: .5, sd: 80, r: 6 },
    fm: { alg: 4, fb: 5, ops: [[1, 20, 0, .4, .2, 2, .15, 0], [1, 0, 0, 1, .3, 2.5, .2, 0], [3, 26, 0, .2, 0, 1, .15, 0], [1, 3, 0, 1.2, .3, 2.5, .2, 4]] },
  },
  bass: {
    label: 'ベース', harm: [1, .5, .2, .1], duty: .5,
    env: { a: 0, d: 10, s: .7, sd: 200, r: 4 },
    fm: { alg: 4, fb: 6, ops: [[1, 18, 0, .25, .4, 3, .08, 0], [1, 0, 0, 1.5, .6, 4, .08, 0], [1, 22, 0, .12, .2, 2, .08, 0], [.5, 4, 0, 1.5, .6, 4, .08, 0]] },
  },
  strings: {
    label: 'ストリングス', harm: [1, .5, .33, .25, .2, .17, .14, .12, .11, .1], duty: .25,
    env: { a: 8, d: 10, s: .8, r: 18 }, vib: { delay: 20, depth: 12, rate: 5.5 },
    fm: { alg: 4, fb: 2, ops: [[1, 28, .12, 1, .8, 0, .4, 0], [1, 0, .15, 1, .9, 0, .45, 4], [1, 30, .12, 1, .8, 0, .4, 0], [1, 0, .15, 1, .9, 0, .45, -4]] },
  },
  brass: {
    label: 'ブラス', harm: [1, .9, .75, .6, .45, .3, .2, .1], duty: .25,
    env: { a: 3, d: 10, s: .75, r: 8 }, vib: { delay: 24, depth: 10, rate: 5.5 },
    fm: { alg: 4, fb: 5, ops: [[1, 18, .06, .3, .7, 0, .15, 0], [1, 0, .03, .3, .85, 0, .15, 2], [1, 22, .06, .3, .7, 0, .15, 0], [1, 2, .03, .3, .85, 0, .15, -2]] },
  },
  reed: {
    label: 'リード楽器 (サックス等)', harm: [1, 0, .5, 0, .33, 0, .25, 0, .2], duty: .5,
    env: { a: 2, d: 6, s: .85, r: 6 }, vib: { delay: 20, depth: 12, rate: 5 },
    fm: { alg: 4, fb: 4, ops: [[2, 20, .02, .4, .8, 0, .1, 0], [1, 0, .02, .5, .9, 0, .1, 0], [2, 24, .02, .4, .8, 0, .1, 0], [1, 3, .02, .5, .9, 0, .1, 3]] },
  },
  flute: {
    label: 'フルート / 笛', harm: [1, .15, .05], duty: .5,
    env: { a: 5, d: 5, s: .85, r: 8 }, vib: { delay: 15, depth: 15, rate: 5 },
    fm: { alg: 4, fb: 0, ops: [[1, 36, .06, .5, .8, 0, .12, 0], [1, 0, .05, .5, .9, 0, .12, 0], [1, 40, .06, .5, .8, 0, .12, 0], [2, 14, .05, .5, .9, 0, .12, 0]] },
  },
  lead: {
    label: 'シンセリード', harm: [1, .5, .5, .25, .3, .15, .2, .1], duty: .5,
    env: { a: 0, d: 6, s: .85, r: 6 }, vib: { delay: 18, depth: 20, rate: 6 },
    fm: { alg: 4, fb: 6, ops: [[1, 12, 0, .4, .8, 0, .1, 0], [1, 0, 0, .4, .85, 0, .1, 0], [1, 16, 0, .4, .8, 0, .1, 0], [2, 6, 0, .4, .85, 0, .1, 8]] },
  },
  pad: {
    label: 'パッド', harm: [1, .5, .33, .25, .2], duty: .5,
    env: { a: 20, d: 20, s: .75, r: 30 }, vib: { delay: 0, depth: 6, rate: 4 },
    fm: { alg: 4, fb: 3, ops: [[1, 30, .4, 1, .8, 0, .8, 0], [1, 0, .5, 1, .85, 0, 1, 6], [2, 34, .4, 1, .8, 0, .8, 0], [1, 2, .5, 1, .85, 0, 1, -6]] },
  },
};

// GM プログラム (0-127) を 8 ずつのファミリーに分けて音色へ
const FAMILY_TONE = ['piano', 'bell', 'organ', 'guitar', 'bass', 'strings', 'strings', 'brass',
  'reed', 'flute', 'lead', 'pad', 'pad', 'guitar', 'bell', 'lead'];

// 音源チップ定義
// groups: ハードウェアチャンネルのまとまり
//   kind: psg(矩形波+ノイズ) / tri(ファミコン三角波) / wave(波形メモリ) / fm(4オペFM) / pcm(サンプルドラム)
//   role: mel(メロディ) / drum(ドラム) / both(兼用、ドラム優先で奪う)
//   clock/div/pOff/maxP: 周波数レジスタ量子化 f = clock / (div * (P + pOff))
//   vol: 音量テーブル  bits: 波形メモリのビット数  noise: ノイズ出力可  noiseOnly: ノイズ専用
// route: ドラムの種類ごとにどのグループで鳴らすか
const CHIPS = [
  {
    id: 'ym2612', type: 'fm', maker: 'セガ', name: 'YM2612 (OPN2) + SN76489', system: 'メガドライブ',
    desc: 'FM 4オペ 5ch + DAC PCMドラム + PSG 矩形波3ch + ノイズ', lpf: 7500, gain: 0.45,
    groups: [
      { name: 'fm', label: 'FM', kind: 'fm', count: 5, role: 'mel', dacBits: 9, stereo: true, gain: 0.55 },
      { name: 'psg', label: 'PSG', kind: 'psg', count: 3, role: 'mel', clock: 3579545, div: 32, pOff: 0, maxP: 1023, vol: 'sn', dutyFixed: true, gain: 0.22 },
      { name: 'dac', label: 'DAC', kind: 'pcm', count: 1, role: 'drum', pcm: { rate: 13000, enc: 'pcm8' }, stereo: true, gain: 0.8 },
      { name: 'nz', label: 'NOISE', kind: 'psg', count: 1, role: 'drum', noiseOnly: true, vol: 'sn', gain: 0.2 },
    ],
    route: { default: ['dac'], hat: ['nz'], ohat: ['nz'], ride: ['nz'], perc: ['nz'] },
  },
  {
    id: 'cps1', type: 'fm', maker: 'カプコン', name: 'YM2151 (OPM) + OKI MSM6295', system: 'CPS-1 (ストリートファイターII 等)',
    desc: 'FM 4オペ 8ch + 4bit ADPCM 4ch (7.5kHz) ドラム', lpf: 9000, gain: 0.44,
    groups: [
      { name: 'fm', label: 'FM', kind: 'fm', count: 8, role: 'mel', dacBits: 10, stereo: true, gain: 0.45 },
      { name: 'oki', label: 'ADPCM', kind: 'pcm', count: 4, role: 'drum', pcm: { rate: 7575, enc: 'adpcm' }, gain: 0.8 },
    ],
    route: { default: ['oki'] },
  },
  {
    id: 'ym2610', type: 'fm', maker: 'タイトー', name: 'YM2610 (OPNB)', system: 'F2システム / ダライアスII (ネオジオも同系)',
    desc: 'FM 4ch + SSG 3ch + ADPCM-A 6ch (18.5kHz) ドラム', lpf: 12000, gain: 0.46,
    groups: [
      { name: 'fm', label: 'FM', kind: 'fm', count: 4, role: 'mel', dacBits: 12, stereo: true, gain: 0.5 },
      { name: 'ssg', label: 'SSG', kind: 'psg', count: 3, role: 'mel', clock: 2000000, div: 16, pOff: 0, maxP: 4095, vol: 'ay', dutyFixed: true, gain: 0.22 },
      { name: 'adpcm', label: 'ADPCM-A', kind: 'pcm', count: 6, role: 'drum', pcm: { rate: 18518, enc: 'adpcm' }, stereo: true, gain: 0.8 },
    ],
    route: { default: ['adpcm'] },
  },
  {
    id: 'namcowsg', type: 'wave', maker: 'ナムコ', name: 'WSG (3ch 波形メモリ)', system: 'パックマン / ギャラガ',
    desc: '4bit・32サンプル波形メモリ 3ch。ノイズ無しなのでドラムも波形で代用', lpf: 10000, gain: 2.0,
    groups: [
      { name: 'wsg', label: 'WSG', kind: 'wave', count: 3, role: 'both', bits: 4, vol: 'lin4', gain: 0.35 },
    ],
    route: { default: ['wsg'] },
  },
  {
    id: 'namcoc30', type: 'wave', maker: 'ナムコ', name: 'C30 (8ch 波形メモリ)', system: 'System 86 / System 1',
    desc: '4bit 波形メモリ 8ch・ステレオ・ノイズモード付き', lpf: 12000, gain: 1.3,
    groups: [
      { name: 'c30', label: 'C30', kind: 'wave', count: 8, role: 'both', bits: 4, vol: 'lin4', noise: true, stereo: true, gain: 0.28 },
    ],
    route: { default: ['c30'] },
  },
  {
    id: 'scc', type: 'wave', maker: 'コナミ', name: 'SCC (K051649) + AY-3-8910', system: 'MSX (グラディウス2・悪魔城ドラキュラ 等)',
    desc: '8bit・32サンプル波形メモリ 5ch + PSG 3ch', lpf: 11000, gain: 1.15,
    groups: [
      { name: 'scc', label: 'SCC', kind: 'wave', count: 5, role: 'mel', bits: 8, vol: 'lin4', clock: 3579545, div: 32, pOff: 1, maxP: 4095, gain: 0.3 },
      { name: 'psg', label: 'PSG', kind: 'psg', count: 3, role: 'both', clock: 1789772, div: 16, pOff: 0, maxP: 4095, vol: 'ay', noise: true, dutyFixed: true, gain: 0.24 },
    ],
    route: { default: ['psg'] },
  },
  {
    id: 'konamiac', type: 'wave', maker: 'コナミ', name: 'K005289 + AY-3-8910 ×2', system: 'グラディウス (アーケード)',
    desc: '4bit 波形メモリ 2ch + PSG 6ch', lpf: 10000, gain: 1.15,
    groups: [
      { name: 'k5289', label: 'K005289', kind: 'wave', count: 2, role: 'mel', bits: 4, vol: 'lin4', clock: 3579545, div: 32, pOff: 0, maxP: 4095, gain: 0.35 },
      { name: 'psg', label: 'PSG', kind: 'psg', count: 6, role: 'both', clock: 1789772, div: 16, pOff: 0, maxP: 4095, vol: 'ay', noise: true, dutyFixed: true, gain: 0.2 },
    ],
    route: { default: ['psg'] },
  },
  {
    id: 'ay8910', type: 'psg', maker: '汎用 PSG', name: 'AY-3-8910 / YM2149', system: 'MSX / 各社アーケード',
    desc: '矩形波 3ch (ノイズはトーンにミックス)。ドラムは 3ch 目を奪う', lpf: 10000, gain: 1.3,
    groups: [
      { name: 'psg', label: 'PSG', kind: 'psg', count: 3, role: 'both', clock: 1789772, div: 16, pOff: 0, maxP: 4095, vol: 'ay', noise: true, dutyFixed: true, gain: 0.3 },
    ],
    route: { default: ['psg'] },
  },
  {
    id: 'zx128', type: 'psg', maker: 'シンクレア', name: 'AY-3-8912', system: 'ZXスペクトラム 128',
    desc: '矩形波 3ch + ノイズ + ハードウェアエンベロープ。ZX チューンは実機どおりに再生', lpf: 10000, gain: 1.3,
    groups: [
      { name: 'psg', label: 'PSG', kind: 'psg', count: 3, role: 'both', clock: 1773400, div: 16, pOff: 0, maxP: 4095, vol: 'ay', noise: true, dutyFixed: true, gain: .3 },
    ],
    route: { default: ['psg'] },
  },
  {
    id: 'sn76489', type: 'psg', maker: 'セガ', name: 'SN76489', system: 'SG-1000 / マスターシステム / ゲームギア',
    desc: '矩形波 3ch + ノイズ 1ch (最低音 約109Hz)', lpf: 10000, gain: 1.0,
    groups: [
      { name: 'sq', label: 'SQ', kind: 'psg', count: 3, role: 'mel', clock: 3579545, div: 32, pOff: 0, maxP: 1023, vol: 'sn', dutyFixed: true, gain: 0.3 },
      { name: 'nz', label: 'NOISE', kind: 'psg', count: 1, role: 'drum', noiseOnly: true, vol: 'sn', gain: 0.3 },
    ],
    route: { default: ['nz'] },
  },
  {
    id: '2a03', type: 'psg', maker: '任天堂', name: '2A03 (RP2A03)', system: 'ファミコン',
    desc: 'パルス 2ch + 三角波 + ノイズ + DPCM (1bit Δ)', lpf: 14000, gain: 0.55, preferTri: true,
    groups: [
      { name: 'pulse', label: 'PULSE', kind: 'psg', count: 2, role: 'mel', clock: 1789773, div: 16, pOff: 1, maxP: 2047, vol: 'lin4', gain: 0.28 },
      { name: 'tri', label: 'TRI', kind: 'tri', count: 1, role: 'mel', clock: 1789773, div: 32, pOff: 1, maxP: 2047, gain: 0.4 },
      { name: 'noise', label: 'NOISE', kind: 'psg', count: 1, role: 'drum', noiseOnly: true, vol: 'lin4', gain: 0.25 },
      { name: 'dpcm', label: 'DPCM', kind: 'pcm', count: 1, role: 'drum', pcm: { rate: 24858, enc: 'dpcm' }, gain: 0.6 },
    ],
    route: { default: ['noise'], kick: ['dpcm'], tom: ['dpcm'] },
  },
  {
    id: 'huc6280', type: 'wave', maker: 'ハドソン / NEC', name: 'HuC6280', system: 'PCエンジン',
    desc: '5bit・32サンプル波形メモリ 6ch・ステレオ (5,6ch はノイズ可)', lpf: 13000, gain: 1.4,
    groups: [
      { name: 'w', label: 'WAVE', kind: 'wave', count: 4, role: 'mel', bits: 5, vol: 'huc', clock: 3579545, div: 32, pOff: 0, maxP: 4095, stereo: true, gain: 0.28 },
      { name: 'wn', label: 'WAVE/N', kind: 'wave', count: 2, role: 'both', bits: 5, vol: 'huc', clock: 3579545, div: 32, pOff: 0, maxP: 4095, noise: true, stereo: true, gain: 0.28 },
    ],
    route: { default: ['wn'] },
  },
];

// ドラム (GM ch10) の分類
function drumClass(n) {
  if (n === 35 || n === 36) return 'kick';
  if (n === 38 || n === 40) return 'snare';
  if (n === 37 || n === 39) return 'clap';
  if (n === 42 || n === 44) return 'hat';
  if (n === 46) return 'ohat';
  if ([41, 43, 45, 47, 48, 50].includes(n)) return 'tom';
  if ([49, 52, 55, 57].includes(n)) return 'crash';
  if ([51, 53, 59].includes(n)) return 'ride';
  return 'perc';
}

// PSG/波形メモリ系ドラムのパラメータ (フレーム単位)
const DRUMS = {
  kick: { tone: [150, 45], sweep: 5, decay: 9, vol: 1 },
  snare: { tone: [240, 160], sweep: 4, noise: 12000, decay: 11, vol: .9 },
  clap: { noise: 9000, decay: 8, vol: .8 },
  hat: { noise: 45000, decay: 3, vol: .5 },
  ohat: { noise: 45000, decay: 16, vol: .45 },
  crash: { noise: 20000, decay: 45, vol: .55 },
  ride: { noise: 45000, decay: 24, vol: .35, short: true },
  tom: { tone: [0, 0], sweep: 8, decay: 12, vol: .9 },
  perc: { noise: 30000, decay: 5, vol: .4 },
};

return { TONES, FAMILY_TONE, CHIPS, drumClass, DRUMS };
})();

// ---- vgmin.js ----
const __m_vgmin_js = (() => {
// VGM ファイルの読み込み: 音源チップへの命令から、各チャンネルの音程・音量・発音を 60Hz ごとに取り出す
// 結果: {
//   voices: [{ name, kind: 'fm'|'psg'|'noise' }],
//   count: フレーム数, data: Float32Array(count * voices * 3) [周波数Hz, 音量0-1, フラグ(1=鳴っている, 2=このフレームで発音, 4=ノイズ)]
//   hits: Int32Array [frame, drumClassIndex, velocity*100, ...]  (リズム音源・PCM ドラムの発音)
//   chips: 使われているチップ名, unsupported: 読み取れないチップ名, duration
// }
const FRAME = 735; // 44100 / 60
const HIT_CLASSES = ['kick', 'snare', 'hat', 'tom', 'crash', 'perc', 'ohat', 'ride', 'clap'];
const HIT = Object.fromEntries(HIT_CLASSES.map((c, i) => [c, i]));

function isVGM(buf) {
  const u = new Uint8Array(buf, 0, 4);
  return (u[0] === 0x56 && u[1] === 0x67 && u[2] === 0x6d && u[3] === 0x20) || (u[0] === 0x1f && u[1] === 0x8b);
}

async function unpackVGM(buf) {
  const u = new Uint8Array(buf);
  if (u[0] !== 0x1f || u[1] !== 0x8b) return buf;
  if (typeof DecompressionStream === 'undefined') throw new Error('このブラウザは圧縮された VGM (.vgz) を開けません。iOS / Safari 16.4 以降が必要です');
  const ds = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(ds).arrayBuffer();
}

const db = (att) => Math.pow(10, -att / 20);
const OPM_NOTE = [0, 1, 2, 2, 3, 4, 5, 5, 6, 7, 8, 8, 9, 10, 11, 11];

function parseVGM(buf) {
  const d = new DataView(buf);
  const u = new Uint8Array(buf);
  if (d.getUint32(0, true) !== 0x206d6756) throw new Error('VGM ファイルではありません');
  const ver = d.getUint32(8, true);
  const dataStart = ver >= 0x150 && d.getUint32(0x34, true) ? 0x34 + d.getUint32(0x34, true) : 0x40;
  const hdr = (o, minVer) => (ver >= minVer && o + 4 <= dataStart ? d.getUint32(o, true) : 0);

  const voices = [];
  const chips = [], unsupported = [];
  const add = (name, kind) => { voices.push({ name, kind }); return voices.length - 1; };
  // 各ボイスの現在の状態
  let st = [];
  const mk = () => ({ freq: 0, vol: 0, on: false, onset: false, noise: false });
  const handlers = {}; // コマンド番号 → (a, b) => void
  const hits = [];
  let frame = 0;
  const hit = (cls, vel = 1) => hits.push(frame, HIT[cls], Math.round(vel * 100));

  // ---------- SN76489 ----------
  const sn = (clock, idx, cmd) => {
    const base = voices.length;
    for (let i = 0; i < 3; i++) add(`SN76489${idx ? '#2' : ''} ${i + 1}`, 'psg');
    add(`SN76489${idx ? '#2' : ''} ノイズ`, 'noise');
    const per = [0, 0, 0], att = [15, 15, 15, 15];
    let latch = 0;
    const upd = (ch) => {
      const v = st[base + ch];
      v.vol = att[ch] >= 15 ? 0 : db(att[ch] * 2);
      v.on = v.vol > 0;
      if (ch < 3) v.freq = clock / (32 * Math.max(1, per[ch]));
      else { v.noise = true; v.freq = 0; }
    };
    handlers[cmd] = (a) => {
      if (a & 0x80) {
        latch = (a >> 4) & 7;
        const ch = latch >> 1;
        if (latch & 1) { const was = att[ch]; att[ch] = a & 15; if (att[ch] < was - 2 && was >= 8) st[base + ch].onset = true; upd(ch); }
        else if (ch < 3) { per[ch] = (per[ch] & 0x3f0) | (a & 15); upd(ch); }
      } else {
        const ch = latch >> 1;
        if (latch & 1) { att[ch] = a & 15; upd(ch); }
        else if (ch < 3) { per[ch] = (per[ch] & 15) | ((a & 0x3f) << 4); upd(ch); }
      }
    };
  };

  // ---------- AY8910 / OPN の SSG 部 ----------
  const ssg = (name, toneClock) => {
    const base = voices.length;
    for (let i = 0; i < 3; i++) add(`${name} ${'ABC'[i]}`, 'psg');
    const nz = add(`${name} ノイズ`, 'noise');
    const R = new Uint8Array(16);
    const upd = () => {
      let nv = 0;
      for (let ch = 0; ch < 3; ch++) {
        const v = st[base + ch];
        const vr = R[8 + ch];
        const vol = vr & 16 ? 13 : vr & 15;
        const tone = !(R[7] & (1 << ch)), noise = !(R[7] & (8 << ch));
        const was = v.vol;
        v.vol = tone && vol ? db((15 - vol) * 3) : 0;
        v.freq = toneClock / (16 * Math.max(1, R[ch * 2] | ((R[ch * 2 + 1] & 15) << 8)));
        v.on = v.vol > 0;
        if (v.vol > was * 1.9 && v.vol > .2) v.onset = true;
        if (noise && vol) nv = Math.max(nv, db((15 - vol) * 3));
      }
      const n = st[nz];
      if (nv > n.vol * 1.9 && nv > .2) n.onset = true;
      n.vol = nv; n.on = nv > 0; n.noise = true;
    };
    return (r, v) => { if (r < 14) { R[r] = v; upd(); } };
  };

  // ---------- OPN (YM2203 / YM2608 / YM2610 / YM2612) ----------
  const opn = (name, clock, presc, nch, chanMap) => {
    const base = voices.length;
    const vids = [];
    for (let i = 0; i < nch; i++) vids.push(add(`${name} FM${i + 1}`, 'fm'));
    const fn = new Array(6).fill(0), blk = new Array(6).fill(0), hi = [0, 0], alg = new Array(6).fill(0);
    const tl = Array.from({ length: 6 }, () => [127, 127, 127, 127]);
    const CAR = [[3], [3], [3], [3], [2, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
    const vidOf = (hwch) => { const k = chanMap.indexOf(hwch); return k < 0 ? -1 : base + k; };
    const upd = (hw) => {
      const id = vidOf(hw); if (id < 0) return;
      const v = st[id];
      v.freq = fn[hw] * clock * Math.pow(2, blk[hw] - 1) / (presc * 1048576);
      v.vol = db(Math.min(...CAR[alg[hw]].map((k) => tl[hw][k])) * .75);
    };
    return (port, r, val) => {
      if (port === 0 && r === 0x28) {
        const c = val & 7; const hw = c >= 4 ? c - 1 : c;
        const id = vidOf(hw); if (id < 0) return;
        const on = (val & 0xf0) !== 0;
        if (on) st[id].onset = true;
        st[id].on = on; upd(hw);
        return;
      }
      if (r < 0x30) return;
      const c = r & 3; if (c === 3) return;
      const hw = c + port * 3;
      if (r >= 0x40 && r < 0x50) { tl[hw][(r >> 2) & 3] = val & 127; upd(hw); }
      else if (r >= 0xa4 && r < 0xa7) hi[port] = val;
      else if (r >= 0xa0 && r < 0xa3) { fn[hw] = ((hi[port] & 7) << 8) | val; blk[hw] = (hi[port] >> 3) & 7; upd(hw); }
      else if (r >= 0xb0 && r < 0xb3) { alg[hw] = val & 7; upd(hw); }
    };
  };

  // ---------- OPM (YM2151) ----------
  const opm = (clock, idx, cmd) => {
    const base = voices.length;
    for (let i = 0; i < 8; i++) add(`YM2151${idx ? '#2' : ''} ${i + 1}`, 'fm');
    const kc = new Array(8).fill(0), kf = new Array(8).fill(0), alg = new Array(8).fill(0);
    const tl = Array.from({ length: 8 }, () => [127, 127, 127, 127]);
    const CAR = [[3], [3], [3], [3], [2, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
    const upd = (ch) => {
      const v = st[base + ch];
      const midi = 12 * ((kc[ch] >> 4) & 7) + OPM_NOTE[kc[ch] & 15] + 13 + kf[ch] / 64;
      v.freq = 440 * Math.pow(2, (midi - 69) / 12) * clock / 3579545;
      v.vol = db(Math.min(...CAR[alg[ch]].map((k) => tl[ch][k])) * .75);
    };
    handlers[cmd] = (r, val) => {
      if (r === 0x08) { const ch = val & 7; const on = (val & 0x78) !== 0; if (on) st[base + ch].onset = true; st[base + ch].on = on; upd(ch); }
      else if (r >= 0x20 && r < 0x28) { alg[r & 7] = val & 7; upd(r & 7); }
      else if (r >= 0x28 && r < 0x30) { kc[r & 7] = val; upd(r & 7); }
      else if (r >= 0x30 && r < 0x38) { kf[r & 7] = val >> 2; upd(r & 7); }
      else if (r >= 0x60 && r < 0x80) { tl[r & 7][(r - 0x60) >> 3] = val & 127; upd(r & 7); }
    };
  };

  // ---------- OPL (YM3812 / YM3526 / Y8950 / YMF262) ----------
  const OPL_OP = [0, 1, 2, 8, 9, 10, 16, 17, 18];
  const opl = (name, rate, nport, cmds) => {
    const base = voices.length;
    for (let i = 0; i < 9 * nport; i++) add(`${name} ${i + 1}`, 'fm');
    const fn = new Array(18).fill(0), blk = new Array(18).fill(0), con = new Array(18).fill(0);
    const tl = Array.from({ length: 18 }, () => [63, 63]);
    let rhythm = 0, rbits = 0;
    const upd = (c) => {
      const v = st[base + c];
      v.freq = fn[c] * rate / Math.pow(2, 20 - blk[c]);
      v.vol = db((con[c] ? Math.min(tl[c][0], tl[c][1]) : tl[c][1]) * .75);
    };
    cmds.forEach((cmd, port) => {
      handlers[cmd] = (r, val) => {
        if (r >= 0xa0 && r < 0xa9) { const c = r - 0xa0 + 9 * port; fn[c] = (fn[c] & 0x300) | val; upd(c); }
        else if (r >= 0xb0 && r < 0xb9) {
          const c = r - 0xb0 + 9 * port;
          fn[c] = (fn[c] & 0xff) | ((val & 3) << 8); blk[c] = (val >> 2) & 7;
          const on = (val & 0x20) !== 0, v = st[base + c];
          if (on && !v.on) v.onset = true;
          v.on = on && !(rhythm && port === 0 && c >= 6);
          upd(c);
        } else if (r >= 0xc0 && r < 0xc9) { con[r - 0xc0 + 9 * port] = val & 1; upd(r - 0xc0 + 9 * port); }
        else if (r >= 0x40 && r < 0x56) {
          const off = r - 0x40, slot = off % 8 < 6 ? Math.floor(off / 8) * 3 + (off % 8) % 3 : -1;
          if (slot < 0) return;
          const c = slot + 9 * port, car = (off % 8) >= 3 ? 1 : 0;
          tl[c][car] = val & 63; upd(c);
        } else if (r === 0xbd && port === 0) {
          rhythm = val & 0x20;
          const nb = rhythm ? val & 0x1f : 0;
          const rise = nb & ~rbits;
          if (rise & 16) hit('kick'); if (rise & 8) hit('snare'); if (rise & 4) hit('tom'); if (rise & 2) hit('crash', .7); if (rise & 1) hit('hat', .7);
          rbits = nb;
        }
      };
    });
  };

  // ---------- OPLL (YM2413) ----------
  const opll = (clock, cmd) => {
    const base = voices.length;
    for (let i = 0; i < 9; i++) add(`YM2413 ${i + 1}`, 'fm');
    const fn = new Array(9).fill(0), blk = new Array(9).fill(0), vl = new Array(9).fill(0);
    let rhythm = 0, rbits = 0;
    const upd = (c) => { const v = st[base + c]; v.freq = fn[c] * (clock / 72) / Math.pow(2, 19 - blk[c]); v.vol = db(vl[c] * 3); };
    handlers[cmd] = (r, val) => {
      if (r >= 0x10 && r < 0x19) { const c = r - 0x10; fn[c] = (fn[c] & 0x100) | val; upd(c); }
      else if (r >= 0x20 && r < 0x29) {
        const c = r - 0x20; fn[c] = (fn[c] & 0xff) | ((val & 1) << 8); blk[c] = (val >> 1) & 7;
        const on = (val & 0x10) !== 0, v = st[base + c];
        if (on && !v.on) v.onset = true;
        v.on = on && !(rhythm && c >= 6); upd(c);
      } else if (r >= 0x30 && r < 0x39) { vl[r - 0x30] = val & 15; upd(r - 0x30); }
      else if (r === 0x0e) {
        rhythm = val & 0x20;
        const nb = rhythm ? val & 0x1f : 0, rise = nb & ~rbits;
        if (rise & 16) hit('kick'); if (rise & 8) hit('snare'); if (rise & 4) hit('tom'); if (rise & 2) hit('crash', .7); if (rise & 1) hit('hat', .7);
        rbits = nb;
      }
    };
  };

  // ---------- チップの登録 ----------
  const clk = (o, v) => hdr(o, v) & 0x3fffffff;
  const dual = (o, v) => (hdr(o, v) & 0x40000000) !== 0;
  const OPN_KEYS = [0x10, 0x08, 0x02, 0x01, 0x04, 0x20]; // YM2608 リズム: BD SD TOP HH TOM RIM
  const RH = ['kick', 'snare', 'crash', 'hat', 'tom', 'perc'];

  if (clk(0x0c, 0)) { chips.push('SN76489'); sn(clk(0x0c, 0), 0, 0x50); if (dual(0x0c, 0)) sn(clk(0x0c, 0), 1, 0x30); }
  if (clk(0x10, 0x101)) { chips.push('YM2413'); opll(clk(0x10, 0x101), 0x51); }
  if (clk(0x2c, 0x110)) {
    chips.push('YM2612');
    const w = opn('YM2612', clk(0x2c, 0x110), 144, 6, [0, 1, 2, 3, 4, 5]);
    handlers[0x52] = (r, v) => w(0, r, v); handlers[0x53] = (r, v) => w(1, r, v);
  }
  if (clk(0x30, 0x110)) { chips.push('YM2151'); opm(clk(0x30, 0x110), 0, 0x54); if (dual(0x30, 0x110)) opm(clk(0x30, 0x110), 1, 0xa4); }
  const ym2203 = (idx, cmd) => {
    const c = clk(0x44, 0x151), name = 'YM2203' + (idx ? '#2' : '');
    const w = opn(name, c, 72, 3, [0, 1, 2]);
    const s = ssg(name + ' SSG', c / 4);
    handlers[cmd] = (r, v) => { if (r < 0x10) s(r, v); else w(0, r, v); };
  };
  if (clk(0x44, 0x151)) { chips.push('YM2203'); ym2203(0, 0x55); if (dual(0x44, 0x151)) ym2203(1, 0xa5); }
  if (clk(0x48, 0x151)) {
    chips.push('YM2608');
    const c = clk(0x48, 0x151);
    const w = opn('YM2608', c, 144, 6, [0, 1, 2, 3, 4, 5]), s = ssg('YM2608 SSG', c / 4);
    handlers[0x56] = (r, v) => {
      if (r < 0x10) s(r, v);
      else if (r === 0x10 && !(v & 0x80)) OPN_KEYS.forEach((b, i) => { if (v & (1 << i)) hit(RH[i]); });
      else w(0, r, v);
    };
    handlers[0x57] = (r, v) => w(1, r, v);
  }
  if (clk(0x4c, 0x151)) {
    chips.push('YM2610');
    const c = clk(0x4c, 0x151);
    const w = opn('YM2610', c, 144, 4, [1, 2, 4, 5]), s = ssg('YM2610 SSG', c / 4);
    handlers[0x58] = (r, v) => { if (r < 0x10) s(r, v); else w(0, r, v); };
    const ACH = ['kick', 'snare', 'hat', 'tom', 'crash', 'perc'];
    handlers[0x59] = (r, v) => {
      if (r === 0x00 && !(v & 0x80)) { for (let i = 0; i < 6; i++) if (v & (1 << i)) hit(ACH[i]); }
      else w(1, r, v);
    };
  }
  const oplChip = (o, v, name, cmd, cmd2) => {
    if (!clk(o, v)) return;
    chips.push(name);
    opl(name, clk(o, v) / 72, 1, [cmd]);
    if (dual(o, v)) opl(name + '#2', clk(o, v) / 72, 1, [cmd2]);
  };
  oplChip(0x50, 0x151, 'YM3812', 0x5a, 0xaa);
  oplChip(0x54, 0x151, 'YM3526', 0x5b, 0xab);
  oplChip(0x58, 0x151, 'Y8950', 0x5c, 0xac);
  if (clk(0x5c, 0x151)) { chips.push('YMF262'); opl('YMF262', clk(0x5c, 0x151) / 288, 2, [0x5e, 0x5f]); }
  if (clk(0x74, 0x151)) {
    chips.push('AY8910');
    const c = clk(0x74, 0x151);
    const a = ssg('AY8910', c), b = dual(0x74, 0x151) ? ssg('AY8910#2', c) : null;
    handlers[0xa0] = (r, v) => { if (r & 0x80) { if (b) b(r & 0x7f, v); } else a(r, v); };
  }
  if (clk(0x98, 0x161)) {
    chips.push('OKIM6295');
    const OK = ['kick', 'snare', 'hat', 'crash', 'tom', 'perc'];
    let pend = -1;
    const okiCmd = (r, v) => {
      if (r !== 0) return;
      if (pend >= 0) { if (v & 0xf0) hit(OK[pend % OK.length], .9); pend = -1; }
      else if (v & 0x80) pend = v & 0x7f;
    };
    handlers[0xb8] = okiCmd;
  }
  // ---------- ファミコン (NES APU) ----------
  if (clk(0x84, 0x161)) {
    chips.push('NES APU');
    const clock = clk(0x84, 0x161);
    const base = voices.length;
    add('ファミコン パルス1', 'psg'); add('ファミコン パルス2', 'psg'); add('ファミコン 三角波', 'psg'); add('ファミコン ノイズ', 'noise');
    const R = new Uint8Array(0x20);
    let en = 0x0f; // $4015 が記録されていない VGM もあるので全チャンネル有効から始める
    const upd = () => {
      for (let k = 0; k < 2; k++) {
        const v = st[base + k], b = k * 4;
        const t = R[b + 2] | ((R[b + 3] & 7) << 8);
        const vol = R[b] & 0x10 ? R[b] & 15 : 12;
        v.freq = clock / (16 * (t + 1)); v.vol = vol / 15; v.on = !!(en & (1 << k)) && vol > 0 && t >= 8;
      }
      const tv = st[base + 2], tt = R[0x0a] | ((R[0x0b] & 7) << 8);
      tv.freq = clock / (32 * (tt + 1)); tv.vol = .8; tv.on = !!(en & 4) && (R[0x08] & 0x7f) > 0 && tt >= 2;
      const nv = st[base + 3], nvol = R[0x0c] & 0x10 ? R[0x0c] & 15 : 12;
      nv.noise = true; nv.vol = nvol / 15; nv.on = !!(en & 8) && nvol > 0;
    };
    handlers[0xb4] = (a, d) => {
      if (a & 0x80) return; // 2 個目のチップは無視
      if (a < 0x20) R[a] = d;
      if (a === 0x15) en = d;
      if (a === 0x03) st[base].onset = true;
      if (a === 0x07) st[base + 1].onset = true;
      if (a === 0x0b) st[base + 2].onset = true;
      if (a === 0x0f) st[base + 3].onset = true;
      upd();
    };
  }

  // ---------- ゲームボーイ (DMG) ----------
  if (clk(0x80, 0x161)) {
    chips.push('GameBoy');
    const base = voices.length;
    add('GB パルス1', 'psg'); add('GB パルス2', 'psg'); add('GB 波形', 'psg'); add('GB ノイズ', 'noise');
    const R = new Uint8Array(0x30);
    const vol = [0, 0, 0, 0];
    const upd = () => {
      const p = (k, o) => { const v = st[base + k]; const x = R[o + 3] | ((R[o + 4] & 7) << 8); v.freq = 131072 / (2048 - x); v.vol = vol[k] / 15; v.on = vol[k] > 0; };
      p(0, 0x00); p(1, 0x05);
      const w = st[base + 2], x = R[0x0d] | ((R[0x0e] & 7) << 8), code = (R[0x0c] >> 5) & 3;
      w.freq = 65536 / (2048 - x); w.vol = [0, 1, .5, .25][code]; w.on = !!(R[0x0a] & 0x80) && code > 0 && vol[2] > 0;
      const n = st[base + 3]; n.noise = true; n.vol = vol[3] / 15; n.on = vol[3] > 0;
    };
    handlers[0xb3] = (a, d) => {
      if (a & 0x80) return;
      if (a < 0x30) R[a] = d;
      // 発音 (トリガー) の時に音量を取り込む
      if (a === 0x04 && d & 0x80) { vol[0] = R[0x02] >> 4; st[base].onset = true; }
      if (a === 0x09 && d & 0x80) { vol[1] = R[0x07] >> 4; st[base + 1].onset = true; }
      if (a === 0x0e && d & 0x80) { vol[2] = 15; st[base + 2].onset = true; }
      if (a === 0x13 && d & 0x80) { vol[3] = R[0x11] >> 4; st[base + 3].onset = true; }
      if (a === 0x02 && !(d & 0xf8)) vol[0] = 0;
      if (a === 0x07 && !(d & 0xf8)) vol[1] = 0;
      if (a === 0x11 && !(d & 0xf8)) vol[3] = 0;
      if (a === 0x16 && !(d & 0x80)) vol.fill(0);
      upd();
    };
  }

  // ---------- PCエンジン (HuC6280) ----------
  if (clk(0xa4, 0x161)) {
    chips.push('HuC6280');
    const clock = clk(0xa4, 0x161);
    const base = voices.length;
    for (let i = 0; i < 6; i++) add(`PCエンジン ${i + 1}`, 'psg');
    const nz = add('PCエンジン ノイズ', 'noise');
    const fr = new Array(6).fill(0), ctl = new Array(6).fill(0), noise = new Array(6).fill(0);
    let sel = 0;
    const upd = (c) => {
      const v = st[base + c], on = (ctl[c] & 0x80) && !(ctl[c] & 0x40) && (ctl[c] & 31) > 0;
      const vol = db((31 - (ctl[c] & 31)) * 1.5);
      if (noise[c] & 0x80) { v.on = false; } else { v.freq = clock / (32 * Math.max(1, fr[c])); v.vol = vol; v.on = !!on; }
      let nv = 0;
      for (let k = 4; k < 6; k++) if (noise[k] & 0x80 && ctl[k] & 0x80) nv = Math.max(nv, db((31 - (ctl[k] & 31)) * 1.5));
      const n = st[nz]; if (nv > n.vol * 1.9 && nv > .2) n.onset = true; n.noise = true; n.vol = nv; n.on = nv > 0;
    };
    handlers[0xb9] = (a, d) => {
      if (a & 0x80) return;
      if (a === 0) { sel = d & 7; return; }
      if (sel > 5) return;
      if (a === 2) fr[sel] = (fr[sel] & 0xf00) | d;
      else if (a === 3) fr[sel] = (fr[sel] & 0xff) | ((d & 15) << 8);
      else if (a === 4) { if (d & 0x80 && !(ctl[sel] & 0x80)) st[base + sel].onset = true; ctl[sel] = d; }
      else if (a === 7) noise[sel] = d;
      else return;
      upd(sel);
    };
  }

  // ---------- コナミ SCC (K051649 / SCC+) ----------
  if (clk(0x9c, 0x161)) {
    chips.push('K051649 (SCC)');
    const clock = clk(0x9c, 0x161);
    const base = voices.length;
    for (let i = 0; i < 5; i++) add(`SCC ${i + 1}`, 'psg');
    const fr = new Array(5).fill(0), vl = new Array(5).fill(0);
    let keys = 0;
    const upd = (c) => { const v = st[base + c]; v.freq = clock / (16 * (fr[c] + 1)); v.vol = vl[c] / 15; v.on = !!(keys & (1 << c)) && vl[c] > 0 && fr[c] > 8; };
    handlers[0xd2] = (port, a, d) => {
      port &= 0x7f;
      if (port === 1) { const c = a >> 1; if (c > 4) return; fr[c] = a & 1 ? (fr[c] & 0xff) | ((d & 15) << 8) : (fr[c] & 0xf00) | d; upd(c); }
      else if (port === 2) { if (a > 4) return; if ((d & 15) > vl[a] + 3) st[base + a].onset = true; vl[a] = d & 15; upd(a); }
      else if (port === 3) { const rise = d & ~keys; keys = d; for (let c = 0; c < 5; c++) { if (rise & (1 << c)) st[base + c].onset = true; upd(c); } }
    };
  }

  // 読み取れない (PCM だけで音程を持つ) チップ
  const PCM = { 0x38: 'SegaPCM', 0x88: 'MultiPCM', 0xa0: 'K054539', 0xa8: 'C140', 0xac: 'K053260', 0xb4: 'QSound', 0xd8: 'X1-010', 0xdc: 'C352', 0xe0: 'GA20', 0x68: 'YMZ280B', 0x60: 'YMF278B', 0x64: 'YMF271' };
  for (const [o, n] of Object.entries(PCM)) { const off = +o; if (clk(off, off >= 0xc0 ? 0x171 : off >= 0x80 ? 0x161 : 0x151)) unsupported.push(n); }

  // ---------- コマンドを読み進めて 60Hz ごとに記録 ----------
  st = voices.map(mk);
  const nv = voices.length;
  const total = d.getUint32(0x18, true);
  const maxFrames = Math.min(Math.ceil(total / FRAME) + 2, 60 * 60 * 10);
  const data = new Float32Array(maxFrames * nv * 3);
  let t = 0, nextFrame = FRAME, p = dataStart;
  const snap = () => {
    if (frame >= maxFrames) return;
    const o = frame * nv * 3;
    for (let i = 0; i < nv; i++) {
      const v = st[i];
      data[o + i * 3] = v.freq;
      data[o + i * 3 + 1] = v.on ? v.vol : 0;
      data[o + i * 3 + 2] = (v.on ? 1 : 0) | (v.onset ? 2 : 0) | (v.noise ? 4 : 0);
      v.onset = false;
    }
    frame++;
  };
  const wait = (n) => { t += n; while (t >= nextFrame) { snap(); nextFrame += FRAME; } };
  while (p < u.length && frame < maxFrames) {
    const c = u[p];
    if (c === 0x66) break;
    if (c === 0x61) { wait(d.getUint16(p + 1, true)); p += 3; continue; }
    if (c === 0x62) { wait(735); p++; continue; }
    if (c === 0x63) { wait(882); p++; continue; }
    if ((c & 0xf0) === 0x70) { wait((c & 15) + 1); p++; continue; }
    if ((c & 0xf0) === 0x80) { wait(c & 15); p++; continue; }
    if (c === 0x67) { p += 7 + d.getUint32(p + 3, true); continue; }
    if (c === 0x68) { p += 12; continue; }
    if (c >= 0x90 && c <= 0x95) { p += [5, 5, 6, 11, 2, 5][c - 0x90]; continue; }
    const h = handlers[c];
    if (c === 0x50 || c === 0x30) { if (h) h(u[p + 1]); p += 2; continue; }
    if (c === 0x4f) { p += 2; continue; }
    if (c >= 0x30 && c <= 0x3f) { p += 2; continue; }
    if (c >= 0x40 && c <= 0x4e) { p += 3; continue; }
    if (c >= 0x51 && c <= 0x5f) { if (h) h(u[p + 1], u[p + 2]); p += 3; continue; }
    if (c >= 0xa0 && c <= 0xbf) { if (h) h(u[p + 1], u[p + 2]); p += 3; continue; }
    if (c >= 0xc0 && c <= 0xdf) { if (h) h(u[p + 1], u[p + 2], u[p + 3]); p += 4; continue; }
    if (c >= 0xe0) { p += 5; continue; }
    p++; // 不明なコマンド
  }
  snap();
  const count = frame;

  return {
    voices, count, data: data.subarray(0, count * nv * 3), hits: Int32Array.from(hits),
    chips, unsupported, duration: count / 60,
  };
}

return { FRAME, HIT_CLASSES, isVGM, unpackVGM, parseVGM };
})();

// ---- engine.js ----
const __m_engine_js = (() => {
// 音源エンジン: MIDI イベントを選んだチップのハードウェアチャンネルに割り当てて合成する
const { TONES, FAMILY_TONE, CHIPS, drumClass, DRUMS } = __m_chips_js;
const FRAME_HZ = 60;
const MOD = 4;                    // FM 変調の深さ (周期単位)
const FB = [0, .125, .25, .5, 1, 2, 4, 8];
const SIN = new Float32Array(4096);
for (let i = 0; i < 4096; i++) SIN[i] = Math.sin(i / 4096 * Math.PI * 2);

// 音量テーブル
const VOL = {
  sn: Array.from({ length: 16 }, (_, q) => q ? Math.pow(10, -(15 - q) * 2 / 20) : 0),
  ay: [0, .0137, .0205, .0291, .0423, .0618, .0847, .1369, .1691, .2647, .3527, .4499, .5704, .6873, .8482, 1],
  lin4: Array.from({ length: 16 }, (_, q) => q / 15),
  huc: Array.from({ length: 32 }, (_, q) => q ? Math.pow(10, -(31 - q) * 1.5 / 20) : 0),
};

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

// 波形メモリ (32 サンプル) を倍音から生成して bits に量子化
const waveCache = new Map();
function waveTable(key, bits) {
  const id = key + bits;
  if (waveCache.has(id)) return waveCache.get(id);
  const t = new Float32Array(32);
  if (key === 'noise32') {
    let s = 12345;
    for (let i = 0; i < 32; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; t[i] = (s / 0x7fffffff) * 2 - 1; }
  } else {
    const h = key === 'sine' ? [1] : TONES[key].harm;
    let max = 0;
    for (let i = 0; i < 32; i++) {
      let v = 0;
      for (let k = 0; k < h.length; k++) v += h[k] * Math.sin(2 * Math.PI * (k + 1) * i / 32);
      t[i] = v; max = Math.max(max, Math.abs(v));
    }
    for (let i = 0; i < 32; i++) t[i] /= max;
  }
  const levels = (1 << bits) - 1;
  for (let i = 0; i < 32; i++) t[i] = Math.round((t[i] * .5 + .5) * levels) / levels * 2 - 1;
  waveCache.set(id, t);
  return t;
}

// ---- PCM ドラムサンプル (チップのサンプルレートで合成 → 各方式でエンコード/デコード) ----
const pcmCache = new Map();
function drumSample(cls, rate, enc) {
  const id = cls + rate + enc;
  if (pcmCache.has(id)) return pcmCache.get(id);
  const x = drumRaw(cls, rate), len = x.length;
  let out = x;
  if (enc === 'pcm8') out = x.map((v) => Math.round(v * 127) / 127);
  else if (enc === 'adpcm') out = adpcmRoundTrip(x);
  else if (enc === 'dpcm') {
    out = new Float32Array(len); let lvl = 64;
    for (let i = 0; i < len; i++) {
      const target = (x[i] * .5 + .5) * 127;
      lvl += target > lvl ? 2 : -2; lvl = Math.max(0, Math.min(127, lvl));
      out[i] = (lvl - 64) / 64;
    }
  }
  pcmCache.set(id, out);
  return out;
}

// ドラム音をチップのサンプルレートで合成 (-0.95〜0.95 に正規化)
const DRUM_CLASSES = ['kick', 'snare', 'clap', 'hat', 'ohat', 'crash', 'ride', 'tom', 'perc'];
function drumRaw(cls, rate) {
  const len = Math.floor(rate * ({ crash: 1.1, ride: .7, ohat: .35 }[cls] || .3));
  const x = new Float32Array(len);
  let seed = 1, ph = 0, prevN = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const n = rnd(); const hp = n - prevN; prevN = n;
    let v = 0;
    switch (cls) {
      case 'kick': { const f = 45 + 120 * Math.exp(-t * 35); ph += f / rate; v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) + n * .3 * Math.exp(-t * 120); break; }
      case 'snare': { ph += 185 / rate; v = Math.sin(2 * Math.PI * ph) * .6 * Math.exp(-t * 25) + n * .8 * Math.exp(-t * 14); break; }
      case 'clap': v = n * Math.exp(-((t * 1000) % 12) / 4) * Math.exp(-t * 12); break;
      case 'hat': v = hp * .5 * Math.exp(-t * 60); break;
      case 'ohat': v = hp * .5 * Math.exp(-t * 9); break;
      case 'crash': v = (hp * .45 + n * .15) * Math.exp(-t * 3.2); break;
      case 'ride': { ph += 520 / rate; v = (hp * .3 + Math.sign(Math.sin(2 * Math.PI * ph)) * .08) * Math.exp(-t * 5); break; }
      case 'tom': { const f = 110 + 60 * Math.exp(-t * 18); ph += f / rate; v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 8); break; }
      default: v = hp * .5 * Math.exp(-t * 40);
    }
    x[i] = v;
  }
  let m = 0; for (const v of x) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < len; i++) x[i] = x[i] / m * .95;
  return x;
}

// OKI / YM2610 ADPCM-A 方式 (4bit) でエンコード → デコード
const STEPS = [16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552];
const IDX_ADJ = [-1, -1, -1, -1, 2, 4, 6, 8];
function adpcmRoundTrip(x) {
  const out = new Float32Array(x.length);
  let sig = 0, idx = 0;
  for (let i = 0; i < x.length; i++) {
    const target = Math.round(x[i] * 2047);
    const step = STEPS[idx];
    const diff = target - sig;
    const sign = diff < 0 ? 8 : 0;
    const q = Math.max(0, Math.min(7, Math.round((Math.abs(diff) * 8 / step - 1) / 2)));
    const d = ((q * 2 + 1) * step) >> 3;
    sig += sign ? -d : d;
    sig = Math.max(-2048, Math.min(2047, sig));
    idx = Math.max(0, Math.min(48, idx + IDX_ADJ[q]));
    out[i] = sig / 2048;
  }
  return out;
}

function nearestIdx(table, v) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < table.length; i++) { const dd = Math.abs(table[i] - v); if (dd < bd) { bd = dd; best = i; } }
  return best;
}

function newMidiCh() {
  return { program: 0, vol: 100 / 127, expr: 1, pan: 64, sus: false, bend: 0, range: 2, rpn: 0x3fff, held: new Map() };
}

class Engine {
  constructor(sr) {
    this.sr = sr;
    this.frameLen = sr / FRAME_HZ;
    this.frameLeft = this.frameLen;
    this.age = 0;
    this.mutes = new Array(16).fill(false);
    this.tones = new Array(16).fill(null); // 音色の上書き
    this.scale = 1;
    this.midi = Array.from({ length: 16 }, newMidiCh);
    this.lp1 = [0, 0]; this.lp2 = [0, 0]; this.dc = [0, 0]; this.dcIn = [0, 0];
    this.setChip(CHIPS[0].id);
  }

  setChip(id, scale = this.scale) {
    const def = CHIPS.find((c) => c.id === id) || CHIPS[0];
    this.def = def; this.scale = scale;
    this.lpA = 1 - Math.exp(-2 * Math.PI * def.lpf / this.sr);
    this.chans = [];
    for (const g of def.groups) {
      for (let i = 0; i < g.count * scale; i++) this.chans.push(this.makeChan(g, i));
    }
    this.melPool = this.chans.filter((c) => c.g.role !== 'drum');
    // 和音を鳴らし直す (再生中に音源を切り替えた時)
    for (let ch = 0; ch < 16; ch++) {
      if (ch === 9) continue;
      for (const [note, vel] of this.midi[ch].held) this.noteOn(ch, note, vel);
    }
  }

  makeChan(g, i) {
    const c = { g, i, kind: g.kind, busy: false, note: 0, midiCh: 0, vel: 0, age: 0, released: false, sustained: false,
      drum: null, frame: 0, relFrame: 0, lvl: 0, relStart: 0, amp: 0, phase: 0, inc: 0, duty: .5,
      toneOn: true, noiseOn: false, nPhase: 0, nInc: 0, lfsr: 1, nOut: 1, short: false, table: null,
      pcm: null, pos: 0, step: 0, gl: 1, gr: 1, freq: 0, volGain: 0 };
    if (g.kind === 'fm') c.ops = [0, 1, 2, 3].map(() => ({ ph: 0, inc: 0, lvl: 0, st: 3, aC: 1, dM: 1, sl: 1, d2M: 1, rM: 0, base: 1, gain: 0, mul: 1, dt: 0 }));
    c.fb1 = 0; c.fb2 = 0;
    return c;
  }

  setMutes(m) { this.mutes = m.slice(); for (let ch = 0; ch < 16; ch++) if (m[ch]) this.channelOff(ch, true); }
  setTones(t) { this.tones = t.slice(); }

  reset() {
    for (const c of this.chans) { c.busy = false; c.amp = 0; if (c.ops) for (const o of c.ops) { o.lvl = 0; o.st = 3; } }
    this.midi = Array.from({ length: 16 }, newMidiCh);
  }

  // 鳴っている音をすべて即座に止める (MIDI のプログラムやコントロールの状態は残す)
  silence() {
    for (const c of this.chans) { c.busy = false; c.amp = 0; c.released = false; if (c.ops) for (const o of c.ops) { o.lvl = 0; o.st = 3; } }
  }

  allOff() { for (const c of this.chans) this.release(c); for (const m of this.midi) m.held.clear(); }

  toneKey(ch) { return this.tones[ch] || FAMILY_TONE[this.midi[ch].program >> 3]; }

  event(e) {
    const m = this.midi[e.ch];
    switch (e.type) {
      case 'on':
        if (e.ch !== 9) m.held.set(e.a, e.b);
        if (this.mutes[e.ch]) return;
        if (e.ch === 9) this.drumOn(e.a, e.b); else this.noteOn(e.ch, e.a, e.b);
        break;
      case 'off':
        m.held.delete(e.a);
        if (e.ch === 9) return;
        for (const c of this.chans) {
          if (c.busy && !c.drum && !c.released && c.midiCh === e.ch && c.note === e.a) {
            if (m.sus) c.sustained = true; else this.release(c);
          }
        }
        break;
      case 'cc': this.cc(e.ch, e.a, e.b); break;
      case 'pc': m.program = e.a; break;
      case 'pb': m.bend = e.a / 8192; break;
    }
  }

  cc(ch, n, v) {
    const m = this.midi[ch];
    if (n === 7) m.vol = v / 127;
    else if (n === 11) m.expr = v / 127;
    else if (n === 10) m.pan = v;
    else if (n === 64) {
      m.sus = v >= 64;
      if (!m.sus) for (const c of this.chans) if (c.busy && c.sustained && c.midiCh === ch) { c.sustained = false; this.release(c); }
    } else if (n === 101) m.rpn = (m.rpn & 0x7f) | (v << 7);
    else if (n === 100) m.rpn = (m.rpn & 0x3f80) | v;
    else if (n === 6 && m.rpn === 0) m.range = v;
    else if (n === 121) { m.vol = 100 / 127; m.expr = 1; m.pan = 64; m.bend = 0; m.sus = false; }
    else if (n === 120 || n === 123) this.channelOff(ch, n === 120);
  }

  channelOff(ch, hard) {
    for (const c of this.chans) if (c.busy && c.midiCh === ch) { if (hard) c.busy = false; else this.release(c); }
  }

  pan(c, midiPan) {
    const mode = c.g.stereo;
    if (!mode) { c.gl = c.gr = 1; return; }
    if (this.def.id === 'cps1' || this.def.id === 'ym2612' || this.def.id === 'ym2610') {
      // OPN/OPM は L / C / R の3段階
      c.gl = midiPan > 85 ? 0 : 1; c.gr = midiPan < 43 ? 0 : 1;
      if (c.gl && c.gr) { c.gl = c.gr = 1; } else { c.gl *= 1.4; c.gr *= 1.4; }
    } else {
      const p = midiPan / 127;
      c.gl = Math.cos(p * Math.PI / 2) * 1.414; c.gr = Math.sin(p * Math.PI / 2) * 1.414;
    }
  }

  // ---- メロディ ----
  noteOn(ch, note, vel) {
    const key = this.toneKey(ch);
    let pool = this.melPool;
    if (this.def.preferTri) {
      const triFirst = key === 'bass' || note < 48;
      pool = [...pool].sort((a, b) => ((a.kind === 'tri') === triFirst ? 0 : 1) - ((b.kind === 'tri') === triFirst ? 0 : 1));
    }
    let c = pool.find((x) => x.busy && !x.drum && x.midiCh === ch && x.note === note);
    if (!c) c = pool.find((x) => !x.busy);
    if (!c) {
      // 空きがなければボイスを奪う: リリース中 → 同じ MIDI ch → 最古、の順で優先
      let best = null, bs = Infinity;
      for (const x of pool) {
        if (x.drum && x.frame < 6) continue;
        const s = x.age - (x.released ? 1e9 : 0) - (x.midiCh === ch ? 5e8 : 0);
        if (s < bs) { bs = s; best = x; }
      }
      c = best;
    }
    if (!c) return;
    this.start(c, ch, note, vel / 127, key);
  }

  start(c, ch, note, vel, key) {
    const tone = TONES[key];
    Object.assign(c, { direct: false, busy: true, drum: null, note, midiCh: ch, vel, age: ++this.age, released: false, sustained: false,
      frame: 0, relFrame: 0, tone, toneKey: key, toneOn: true, noiseOn: false });
    this.pan(c, this.midi[ch].pan);
    if (c.kind === 'psg') {
      c.duty = c.g.dutyFixed ? .5 : tone.duty;
      if (c.g.noiseOnly) { c.toneOn = false; c.noiseOn = true; c.nInc = 8000 / this.sr; }
    } else if (c.kind === 'wave') {
      c.table = waveTable(key, c.g.bits);
    } else if (c.kind === 'fm') {
      const p = tone.fm;
      c.alg = p.alg; c.fbAmt = FB[p.fb];
      const sr = this.sr;
      const mulT = (t) => t > 0 ? Math.exp(Math.log(.001) / (t * sr)) : 0;
      p.ops.forEach((d, i) => {
        const o = c.ops[i];
        o.mul = d[0]; o.base = Math.pow(10, -d[1] / 20); o.dt = d[7];
        o.aC = d[2] > 0 ? 1 - Math.exp(-5 / (d[2] * sr)) : 1;
        o.dM = mulT(d[3]); o.sl = d[4]; o.d2M = d[5] > 0 ? mulT(d[5]) : 1; o.rM = mulT(d[6]);
        o.st = 0; o.ph = 0;
      });
      c.fb1 = c.fb2 = 0;
    }
    this.frameUpdate(c, true);
  }

  release(c) {
    if (!c.busy || c.released) return;
    c.released = true; c.relFrame = 0; c.relStart = c.lvl;
    if (c.kind === 'fm') for (const o of c.ops) o.st = 3;
    if (c.kind === 'tri') c.busy = false;
  }

  // ---- ドラム ----
  drumOn(note, vel) {
    const cls = drumClass(note);
    const d = DRUMS[cls];
    const names = this.def.route[cls] || this.def.route.default;
    const needsNoise = !d.tone;
    let cands = [];
    for (const n of names) {
      const list = this.chans.filter((c) => c.g.name === n);
      if (list[0] && list[0].g.role === 'both') list.reverse(); // 兼用チャンネルは後ろから使う
      cands.push(...list);
    }
    cands = cands.filter((c) => !(c.kind === 'psg' && needsNoise && !c.g.noise && !c.g.noiseOnly));
    if (!cands.length) return;
    let c = cands.find((x) => !x.busy);
    if (!c) {
      let best = null, bs = Infinity;
      for (const x of cands) { const s = x.age - (x.drum ? 1e9 : 0); if (s < bs) { bs = s; best = x; } }
      c = best;
    }
    vel /= 127;
    Object.assign(c, { direct: false, busy: true, drum: d, drumCls: cls, note, midiCh: 9, vel, age: ++this.age, released: false, sustained: false, frame: 0, relFrame: 0 });
    this.pan(c, this.midi[9].pan);
    if (c.kind === 'pcm') {
      c.pcm = drumSample(cls, c.g.pcm.rate, c.g.pcm.enc);
      c.pos = 0;
      const pitch = cls === 'tom' ? Math.pow(2, (note - 45) / 18) : 1;
      c.step = c.g.pcm.rate / this.sr * pitch;
      c.amp = vel * this.midi[9].vol * this.midi[9].expr;
      return;
    }
    if (c.kind === 'psg') {
      c.duty = .5;
      if (c.g.noiseOnly) {
        c.toneOn = false; c.noiseOn = true;
        c.nInc = (d.noise || (cls === 'kick' ? 2500 : 5000)) / this.sr;
      } else {
        c.toneOn = !!d.tone; c.noiseOn = !!d.noise && !!c.g.noise;
        c.nInc = (d.noise || 0) / this.sr;
      }
      c.short = !!d.short;
    } else if (c.kind === 'wave') {
      if (d.noise && c.g.noise) { c.noiseOn = true; c.toneOn = false; c.nInc = d.noise / this.sr; }
      else if (d.tone) { c.noiseOn = false; c.toneOn = true; c.table = waveTable('sine', c.g.bits); }
      else { c.noiseOn = false; c.toneOn = true; c.table = waveTable('noise32', c.g.bits); }
    }
    this.frameUpdate(c, true);
  }

  // ZX チューン用: 指定チャンネルで PCM ドラムを鳴らす
  drumOnClass(c, cls, amp) {
    Object.assign(c, { direct: true, busy: true, drum: DRUMS[cls], drumCls: cls, note: 45, midiCh: 3, vel: 1, age: ++this.age, released: false, frame: 0 });
    c.gl = c.gr = 1;
    c.pcm = drumSample(cls, c.g.pcm.rate, c.g.pcm.enc); c.pos = 0;
    c.step = c.g.pcm.rate / this.sr; c.amp = Math.min(1, amp);
  }

  // ---- 60Hz フレーム処理 (エンベロープ・ピッチ・音量の量子化) ----
  frameUpdate(c, first) {
    if (c.direct && !(c.kind === 'fm' && c.released)) return; // ZX チューンから直接制御中
    if (!first) { if (c.released) c.relFrame++; else c.frame++; }
    const m = this.midi[c.midiCh];
    if (c.kind === 'pcm') return;

    if (c.drum) {
      const d = c.drum, f = c.frame;
      if (c.released) c.frame++;
      let lvl = Math.exp(-3 * f / d.decay);
      if (f > d.decay * 1.6) { c.busy = false; c.amp = 0; return; }
      const v = lvl * d.vol * c.vel * m.vol * m.expr;
      let freq = 0;
      if (d.tone) {
        let f0 = d.tone[0], f1 = d.tone[1];
        if (c.drumCls === 'tom') { f0 = 90 * Math.pow(2, (c.note - 41) / 9); f1 = f0 * .6; }
        freq = f0 * Math.pow(f1 / f0, Math.min(1, f / d.sweep));
      } else if (c.kind === 'wave' && !c.noiseOn) freq = 1200;
      if (c.kind === 'tri') freq = freq || 100;
      this.applyPitchVol(c, freq, v);
      return;
    }

    // メロディ: ソフトウェア ADSR
    if (c.kind !== 'fm') {
      const e = c.tone.env;
      let lvl;
      if (!c.released) {
        const f = c.frame;
        if (f < e.a) lvl = (f + 1) / (e.a + 1);
        else if (f < e.a + e.d) lvl = 1 - (1 - e.s) * (f - e.a) / e.d;
        else lvl = e.s * (e.sd ? Math.exp(-(f - e.a - e.d) / e.sd) : 1);
        if (lvl < .01) { c.busy = false; c.amp = 0; return; }
      } else {
        lvl = c.relStart * (1 - c.relFrame / Math.max(1, e.r));
        if (lvl <= 0) { c.busy = false; c.amp = 0; return; }
      }
      c.lvl = lvl;
    } else {
      // FM: キャリアが全部消えたら解放
      const car = CARRIERS[c.alg];
      let alive = false;
      for (const k of car) if (c.ops[k].lvl > 1e-4 || c.ops[k].st === 0) alive = true;
      if (!alive) { c.busy = false; return; }
    }

    let cents = (m.bend * m.range) * 100;
    const vib = c.tone.vib;
    if (vib && c.frame > vib.delay) cents += Math.sin(2 * Math.PI * vib.rate * (c.frame - vib.delay) / FRAME_HZ) * vib.depth;
    const freq = mtof(c.note) * Math.pow(2, cents / 1200);
    const v = (c.kind === 'fm' ? 1 : c.lvl) * c.vel * m.vol * m.expr;
    this.applyPitchVol(c, freq, v);
  }

  applyPitchVol(c, freq, v) {
    const g = c.g;
    if (freq > 0) {
      if (g.clock) {
        // 周波数レジスタに量子化 (低すぎる音はオクターブ上げ)
        const fmin = g.clock / (g.div * (g.maxP + g.pOff));
        while (freq < fmin) freq *= 2;
        const P = Math.max(1, Math.min(g.maxP, Math.round(g.clock / (g.div * freq)) - g.pOff));
        freq = g.clock / (g.div * (P + g.pOff));
        c.P = P; // 実機の周波数レジスタ値 (VGM 書き出し用)
      }
      c.freq = freq;
      c.inc = freq / this.sr;
    }
    if (c.kind === 'fm') {
      // TL は 0.75dB 刻み
      let db = 20 * Math.log10(Math.max(v, 1e-5));
      db = Math.round(db / .75) * .75;
      const vg = Math.pow(10, db / 20);
      c.volGain = vg;
      c.fmAtt = Math.min(127, Math.round(-db / .75));
      const car = CARRIERS[c.alg];
      for (let k = 0; k < 4; k++) {
        const o = c.ops[k];
        o.inc = c.freq * o.mul * Math.pow(2, o.dt / 1200) / this.sr;
        o.gain = car.includes(k) ? o.base * vg : o.base * (.55 + .45 * c.vel);
      }
      return;
    }
    if (c.kind === 'tri') { c.amp = v > .02 ? 1 : 0; return; }
    const table = VOL[g.vol];
    c.volQ = nearestIdx(table, v); // 実機の音量レジスタ値
    c.amp = table[c.volQ];
  }

  // ---- 合成 ----
  render(L, R, off, n) {
    while (n > 0) {
      const seg = Math.min(n, Math.ceil(this.frameLeft));
      this.renderSeg(L, R, off, seg);
      off += seg; n -= seg; this.frameLeft -= seg;
      if (this.frameLeft <= 0) {
        this.frameLeft += this.frameLen;
        for (const c of this.chans) if (c.busy) this.frameUpdate(c, false);
      }
    }
  }

  renderSeg(L, R, off, n) {
    const end = off + n;
    for (const c of this.chans) {
      if (!c.busy) continue;
      const gain = c.g.gain * this.def.gain;
      const gl = c.gl * gain, gr = c.gr * gain;
      switch (c.kind) {
        case 'psg': {
          let ph = c.phase, np = c.nPhase, lf = c.lfsr, no = c.nOut;
          const inc = c.inc, ninc = c.nInc, duty = c.duty, amp = c.amp, tOn = c.toneOn, nOn = c.noiseOn, sh = c.short;
          for (let i = off; i < end; i++) {
            let out = 1;
            if (tOn) { ph += inc; ph -= Math.floor(ph); out = ph < duty ? 1 : -1; }
            if (nOn) {
              np += ninc;
              while (np >= 1) { np -= 1; const b = (lf ^ (lf >> (sh ? 6 : 1))) & 1; lf = (lf >> 1) | (b << 14); no = lf & 1 ? 1 : -1; }
              out = tOn ? (out > 0 && no > 0 ? 1 : -1) : no;
            }
            const v = out * amp;
            L[i] += v * gl; R[i] += v * gr;
          }
          c.phase = ph; c.nPhase = np; c.lfsr = lf; c.nOut = no;
          break;
        }
        case 'tri': {
          let ph = c.phase; const inc = c.inc, amp = c.amp;
          for (let i = off; i < end; i++) {
            ph += inc; ph -= Math.floor(ph);
            const s = (ph * 32) | 0;
            const v = ((s < 16 ? 15 - s : s - 16) / 7.5 - 1) * amp;
            L[i] += v * gl; R[i] += v * gr;
          }
          c.phase = ph;
          break;
        }
        case 'wave': {
          let ph = c.phase, np = c.nPhase, lf = c.lfsr, no = c.nOut;
          const inc = c.inc, amp = c.amp, t = c.table, nOn = c.noiseOn, ninc = c.nInc;
          for (let i = off; i < end; i++) {
            let v;
            if (nOn) {
              np += ninc;
              while (np >= 1) { np -= 1; const b = (lf ^ (lf >> 1)) & 1; lf = (lf >> 1) | (b << 14); no = lf & 1 ? 1 : -1; }
              v = no * amp;
            } else { ph += inc; ph -= Math.floor(ph); v = t[(ph * 32) | 0] * amp; }
            L[i] += v * gl; R[i] += v * gr;
          }
          c.phase = ph; c.nPhase = np; c.lfsr = lf; c.nOut = no;
          break;
        }
        case 'pcm': {
          const s = c.pcm, amp = c.amp, step = c.step;
          let pos = c.pos;
          for (let i = off; i < end; i++) {
            const k = pos | 0;
            if (k >= s.length) { c.busy = false; break; }
            const v = s[k] * amp;
            L[i] += v * gl; R[i] += v * gr;
            pos += step;
          }
          c.pos = pos;
          break;
        }
        case 'fm': this.renderFM(c, L, R, off, end, gl, gr); break;
      }
    }
  }

  renderFM(c, L, R, off, end, gl, gr) {
    const [o1, o2, o3, o4] = c.ops;
    const alg = c.alg, fbAmt = c.fbAmt;
    const q = c.g.dacBits ? (1 << (c.g.dacBits - 1)) : 0;
    let f1 = c.fb1, f2 = c.fb2;
    for (let i = off; i < end; i++) {
      const a = op(o1, (f1 + f2) * .5 * fbAmt);
      f2 = f1; f1 = a;
      let out;
      switch (alg) {
        case 0: out = op(o4, op(o3, op(o2, a * MOD) * MOD) * MOD); break;
        case 1: out = op(o4, op(o3, (a + op(o2, 0)) * MOD) * MOD); break;
        case 2: out = op(o4, (a + op(o3, op(o2, 0) * MOD)) * MOD); break;
        case 3: out = op(o4, (op(o2, a * MOD) + op(o3, 0)) * MOD); break;
        case 4: out = op(o2, a * MOD) + op(o4, op(o3, 0) * MOD); break;
        case 5: out = op(o2, a * MOD) + op(o3, a * MOD) + op(o4, a * MOD); break;
        case 6: out = op(o2, a * MOD) + op(o3, 0) + op(o4, 0); break;
        default: out = a + op(o2, 0) + op(o3, 0) + op(o4, 0);
      }
      if (q) out = Math.round(out * q) / q;
      L[i] += out * gl; R[i] += out * gr;
    }
    c.fb1 = f1; c.fb2 = f2;
  }

  // マスター: ローパス (実機の出力フィルタ相当) + DC カット
  master(L, R, n) {
    const a = this.lpA;
    for (let ch = 0; ch < 2; ch++) {
      const X = ch ? R : L;
      let y1 = this.lp1[ch], y2 = this.lp2[ch], dc = this.dc[ch], px = this.dcIn[ch];
      for (let i = 0; i < n; i++) {
        y1 += a * (X[i] - y1); y2 += a * (y1 - y2);
        dc = y2 - px + .9995 * dc; px = y2;
        X[i] = dc;
      }
      this.lp1[ch] = y1; this.lp2[ch] = y2; this.dc[ch] = dc; this.dcIn[ch] = px;
    }
    this.agc(L, R, n);
  }

  // 自動音量調整: 曲や音源チップによる音量の差をならし、元の音と同じくらいの大きさにそろえる。
  // ゆっくり追従するので曲の中の強弱は残る。大きすぎる瞬間はやわらかく丸めて音割れを防ぐ。
  resetLevel() { this.agcPow = 0; this.agcGain = 1; this.agcTime = 0; }
  agc(L, R, n) {
    const TARGET = .17, MAXG = 8, MING = .5;
    if (this.agcPow === undefined) this.resetLevel();
    let ms = 0;
    for (let i = 0; i < n; i++) ms += L[i] * L[i] + R[i] * R[i];
    ms /= 2 * n;
    const sec = n / this.sr;
    if (ms > 1e-6) {
      // 最初の 2 秒は速く、その後はゆっくり (約 3 秒) 追従
      const T = this.agcTime < 2 ? .4 : 3;
      this.agcTime += sec;
      this.agcPow = this.agcPow ? this.agcPow + (ms - this.agcPow) * (1 - Math.exp(-sec / T)) : ms;
    }
    const want = this.agcPow ? Math.min(MAXG, Math.max(MING, TARGET / Math.sqrt(this.agcPow))) : 1;
    const g0 = this.agcGain;
    const g1 = this.agcGain = g0 + (want - g0) * (1 - Math.exp(-sec / (this.agcTime < 2 ? .2 : .8)));
    for (let ch = 0; ch < 2; ch++) {
      const X = ch ? R : L;
      if (ch && R === L) break;
      for (let i = 0; i < n; i++) {
        let y = X[i] * (g0 + (g1 - g0) * i / n);
        const a = y < 0 ? -y : y;
        if (a > .8) y = (y < 0 ? -1 : 1) * (.8 + .2 * Math.tanh((a - .8) / .2));
        X[i] = y;
      }
    }
  }

  snapshot() {
    return this.chans.map((c) => ({
      label: c.g.label, busy: c.busy, note: c.note, ch: c.midiCh, drum: c.drum ? c.drumCls : (c.kind === 'pcm' && c.busy ? c.drumCls : null),
      lvl: !c.busy ? 0 : c.kind === 'fm' ? Math.max(...CARRIERS[c.alg].map((k) => c.ops[k].lvl)) * c.volGain
        : c.kind === 'pcm' ? c.amp * (1 - c.pos / c.pcm.length) : c.kind === 'tri' ? c.amp * .8 : c.amp,
    }));
  }
}

const CARRIERS = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];

function op(o, mod) {
  let e;
  switch (o.st) {
    case 0: e = o.lvl += (1.02 - o.lvl) * o.aC; if (e >= 1) { e = o.lvl = 1; o.st = o.sl >= 1 ? 2 : 1; } break;
    case 1: e = o.lvl *= o.dM; if (e <= o.sl) { e = o.lvl = o.sl; o.st = 2; } break;
    case 2: e = o.lvl *= o.d2M; break;
    default: e = o.lvl *= o.rM;
  }
  o.ph += o.inc; if (o.ph >= 1) o.ph -= 1;
  return SIN[((o.ph + mod) * 4096) & 4095] * e * o.gain;
}

// シーケンサー: イベント列を時間どおりにエンジンへ流す (AudioWorklet / WAV 書き出し共通)
class Player {
  constructor(sr) {
    this.sr = sr;
    this.engine = new Engine(sr);
    this.events = []; this.idx = 0; this.pos = 0; this.playing = false; this.loop = false; this.duration = 0; this.ended = false;
  }
  snapshot() { return this.engine.snapshot(); }
  setChip(id, scale) { this.engine.setChip(id, scale); }
  load(events, duration) { this.events = events; this.duration = duration; this.engine.resetLevel(); this.seek(0); }
  seek(sec) {
    const e = this.engine;
    e.reset();
    this.pos = Math.max(0, Math.round(sec * this.sr));
    this.ended = false;
    let i = 0;
    for (; i < this.events.length && this.events[i].t < sec; i++) {
      const ev = this.events[i];
      if (ev.type === 'cc' || ev.type === 'pc' || ev.type === 'pb') e.event(ev);
    }
    this.idx = i;
  }
  process(L, R, n) {
    let off = 0;
    while (n > 0) {
      let seg = n;
      if (this.playing) {
        while (this.idx < this.events.length && Math.round(this.events[this.idx].t * this.sr) <= this.pos) this.engine.event(this.events[this.idx++]);
        if (this.idx < this.events.length) seg = Math.min(n, Math.max(1, Math.round(this.events[this.idx].t * this.sr) - this.pos));
      }
      this.engine.render(L, R, off, seg);
      off += seg; n -= seg;
      if (this.playing) {
        this.pos += seg;
        if (this.idx >= this.events.length && this.pos > (this.duration + 1.5) * this.sr) {
          if (this.loop) this.seek(0); else { this.playing = false; this.ended = true; }
        }
      }
    }
    this.engine.master(L, R, L.length);
  }
}

return { waveTable, DRUM_CLASSES, drumRaw, Engine, Player };
})();

// ---- zx.js ----
const __m_zx_js = (() => {
// ZX チューン (AY レジスタのフレーム列) の再生
//  - 'zx128' を選んだ時: AY-3-8912 をそのままエミュレート (ハードウェアエンベロープ込み)
//  - 他の音源を選んだ時: AY の 3ch + ノイズを、そのチップのチャンネルに割り当てて鳴らし直す
const { Engine, waveTable } = __m_engine_js;
const ZX_RATE = 50;
const AYVOL = [0, .0137, .0205, .0291, .0423, .0618, .0847, .1369, .1691, .2647, .3527, .4499, .5704, .6873, .8482, 1];
const CH_NAMES = ['AY A', 'AY B', 'AY C', 'NOISE'];

class ZXPlayer {
  constructor(sr) {
    this.sr = sr;
    this.engine = new Engine(sr);
    this.frames = new Uint8Array(0); this.count = 0; this.clock = 1773400;
    this.fi = 0; this.pos = 0; this.frameLeft = 0;
    this.playing = false; this.loop = false; this.ended = false;
    this.duration = 0;
    this.resetAY();
  }
  get native() { return this.engine.def.id === 'zx128'; }

  load(frames, count, clock) {
    this.engine.resetLevel();
    this.frames = frames; this.count = count; this.clock = clock;
    this.duration = count / ZX_RATE;
    this.seek(0);
  }

  resetAY() {
    this.R = new Uint8Array(16);
    this.tPh = [0, 0, 0]; this.nPh = 0; this.lfsr = 1; this.nOut = 0;
    this.ePh = 0; this.eStep = 15; this.eAtt = 0; this.eHold = 0; this.eAlt = 0; this.eHolding = 0;
    this.slots = [null, null, null]; this.noiseSlot = null; this.prevVol = [0, 0, 0, 0];
    this.lp = [0, 0];
  }

  seek(sec) {
    this.engine.reset();
    this.resetAY();
    this.fi = Math.max(0, Math.min(this.count, Math.floor(sec * ZX_RATE)));
    this.pos = Math.round(this.fi / ZX_RATE * this.sr);
    this.frameLeft = 0;
    this.ended = false;
  }

  setChip(id, scale) {
    this.engine.setChip(id, scale);
    this.slots = [null, null, null]; this.noiseSlot = null; this.prevVol = [0, 0, 0, 0];
  }

  // ---- フレーム開始時: レジスタを反映 ----
  applyFrame() {
    const f = this.fi * 16, F = this.frames, R = this.R;
    for (let r = 0; r < 14; r++) R[r] = F[f + r];
    if (F[f + 14]) {
      const s = R[13];
      this.eAtt = s & 4 ? 15 : 0;
      if (!(s & 8)) { this.eHold = 1; this.eAlt = this.eAtt; } else { this.eHold = s & 1; this.eAlt = s & 2; }
      this.eStep = 15; this.eHolding = 0; this.ePh = 0;
    }
    if (!this.native) this.direct();
  }

  // ---- 別チップで鳴らす: AY の状態 → エンジンのチャンネル ----
  direct() {
    const e = this.engine, R = this.R, clock = this.clock;
    const mel = e.melPool;
    const noiseRate = clock / (16 * Math.max(1, R[6] & 31));
    let noiseVol = 0;
    for (let ch = 0; ch < 3; ch++) {
      const c = mel[ch];
      const vr = R[8 + ch];
      const env = vr & 16;
      const vol = env ? 13 : vr & 15;
      const toneEn = !(R[7] & (1 << ch)), noiseEn = !(R[7] & (8 << ch));
      const shape = R[13];
      let freq = 0;
      if (toneEn) freq = clock / (16 * Math.max(1, R[ch * 2] | ((R[ch * 2 + 1] & 15) << 8)));
      else if (env && (shape === 8 || shape === 12 || shape === 10 || shape === 14)) {
        // バズ音 (エンベロープを音程として使うベース)
        freq = clock / ((shape & 2 ? 512 : 256) * Math.max(1, R[11] | (R[12] << 8)));
      }
      const muted = e.mutes[ch];
      if (noiseEn && vol && !e.mutes[3]) noiseVol = Math.max(noiseVol, vol);
      // AY 系チップ (同じチャンネルでノイズを混ぜられる) はそのまま再現
      const mixNoise = c && c.kind === 'psg' && c.g.noise && noiseEn && !e.mutes[3];
      const audible = !muted && vol > 0 && ((freq > 20 && freq < 14000) || mixNoise);
      if (!c) continue;
      if (!audible) {
        if (c.busy && c.direct) { if (c.kind === 'fm') e.release(c); else { c.busy = false; c.amp = 0; } }
        this.prevVol[ch] = 0;
        continue;
      }
      const key = e.tones[ch] || 'lead';
      const note = freq > 0 ? Math.round(69 + 12 * Math.log2(freq / 440)) : 60;
      const onset = !c.busy || !c.direct || c.released || vol >= this.prevVol[ch] + 3 || c.toneKey !== key;
      if (onset && (c.kind === 'fm' || !c.busy || !c.direct || c.toneKey !== key)) {
        e.start(c, ch, note, 1, key);
        c.direct = true;
      }
      c.note = note; c.midiCh = ch; c.busy = true; c.released = false;
      if (c.kind === 'psg') { c.toneOn = freq > 0; c.noiseOn = !!mixNoise; c.nInc = noiseRate / this.sr; c.duty = c.g.dutyFixed ? .5 : .5; }
      if (c.kind === 'wave') { c.noiseOn = false; c.table = waveTable(key, c.g.bits); }
      e.applyPitchVol(c, freq, AYVOL[vol]);
      this.prevVol[ch] = vol;
    }

    // ノイズ (AY 系以外): ノイズ用チャンネル、無ければ PCM ドラムを打つ
    const mixed = mel[0] && mel[0].kind === 'psg' && mel[0].g.noise;
    if (mixed) return;
    const nc = this.findNoiseChan();
    if (!nc) return;
    if (nc.kind === 'pcm') {
      if (noiseVol && noiseVol >= this.prevVol[3] + 3) {
        const cls = (R[6] & 31) <= 4 ? 'hat' : 'snare';
        e.drumOnClass(nc, cls, AYVOL[noiseVol] * 1.2);
      }
      this.prevVol[3] = noiseVol;
      return;
    }
    if (noiseVol) {
      if (!nc.busy || !nc.direct) { e.start(nc, 3, 60, 1, 'lead'); nc.direct = true; }
      nc.busy = true; nc.midiCh = 3; nc.drum = null; nc.note = 0;
      nc.toneOn = false; nc.noiseOn = true; nc.nInc = noiseRate / this.sr;
      e.applyPitchVol(nc, 0, AYVOL[noiseVol]);
    } else if (nc.busy && nc.direct) { nc.busy = false; nc.amp = 0; }
    this.prevVol[3] = noiseVol;
  }

  findNoiseChan() {
    if (this.noiseSlot && this.engine.chans.includes(this.noiseSlot)) return this.noiseSlot;
    const e = this.engine, mel3 = e.melPool.slice(0, 3);
    const cands = e.chans.filter((c) => !mel3.includes(c));
    this.noiseSlot = cands.find((c) => (c.kind === 'psg' && (c.g.noiseOnly || c.g.noise)) || (c.kind === 'wave' && c.g.noise))
      || cands.find((c) => c.kind === 'pcm') || null;
    return this.noiseSlot;
  }

  // ---- AY をそのまま合成 ----
  renderAY(L, R, off, n) {
    const Rg = this.R, clock = this.clock, sr = this.sr, mutes = this.engine.mutes;
    const tInc = [0, 1, 2].map((ch) => clock / (16 * Math.max(1, Rg[ch * 2] | ((Rg[ch * 2 + 1] & 15) << 8))) / sr);
    const nInc = clock / (16 * Math.max(1, Rg[6] & 31)) / sr;
    const eInc = clock / (16 * Math.max(1, Rg[11] | (Rg[12] << 8))) / sr;
    const mix = Rg[7];
    const hiTone = tInc.map((x) => x > .45); // 可聴域外 (DAC 的な使い方) は常時 ON 扱い
    for (let i = off; i < off + n; i++) {
      this.nPh += nInc;
      while (this.nPh >= 1) { this.nPh -= 1; const b = (this.lfsr ^ (this.lfsr >> 3)) & 1; this.lfsr = (this.lfsr >> 1) | (b << 16); this.nOut = this.lfsr & 1; }
      this.ePh += eInc;
      while (this.ePh >= 1) {
        this.ePh -= 1;
        if (!this.eHolding) {
          this.eStep--;
          if (this.eStep < 0) {
            if (this.eHold) { if (this.eAlt) this.eAtt ^= 15; this.eHolding = 1; this.eStep = 0; }
            else { if (this.eAlt) this.eAtt ^= 15; this.eStep &= 15; }
          }
        }
      }
      const envVol = this.eStep ^ this.eAtt;
      let a = 0, b = 0, c = 0;
      for (let ch = 0; ch < 3; ch++) {
        let ph = this.tPh[ch] + tInc[ch]; ph -= Math.floor(ph); this.tPh[ch] = ph;
        const tone = (mix & (1 << ch)) || hiTone[ch] ? 1 : ph < .5 ? 1 : 0;
        const noise = (mix & (8 << ch)) || mutes[3] ? 1 : this.nOut;
        const vr = Rg[8 + ch];
        const v = mutes[ch] ? 0 : (tone & noise) * AYVOL[vr & 16 ? envVol : vr & 15];
        if (ch === 0) a = v; else if (ch === 1) b = v; else c = v;
      }
      // ABC ステレオ
      L[i] += (a + b * .7 + c * .25) * .42;
      R[i] += (a * .25 + b * .7 + c) * .42;
    }
  }

  process(L, R, n) {
    const fl = this.sr / ZX_RATE;
    let off = 0;
    while (n > 0) {
      if (this.playing && this.frameLeft <= 0) {
        if (this.fi >= this.count) {
          if (this.loop) this.seek(0); else { this.playing = false; this.ended = true; this.R.fill(0); if (!this.native) this.direct(); }
        }
        if (this.playing) { this.applyFrame(); this.fi++; this.frameLeft += fl; }
      }
      const seg = this.playing ? Math.min(n, Math.max(1, Math.ceil(this.frameLeft))) : n;
      if (this.native) { if (this.playing) this.renderAY(L, R, off, seg); }
      else this.engine.render(L, R, off, seg);
      off += seg; n -= seg;
      if (this.playing) { this.pos += seg; this.frameLeft -= seg; }
    }
    if (this.native) this.masterAY(L, R, L.length); else this.engine.master(L, R, L.length);
  }

  masterAY(L, R, n) {
    // AY 出力は片側 (0〜1) なので DC カットのみ
    for (let ch = 0; ch < 2; ch++) {
      const X = ch ? R : L;
      let y = this.lp[ch];
      for (let i = 0; i < n; i++) { y += (X[i] - y) * .0008; X[i] = (X[i] - y) * 1.6; }
      this.lp[ch] = y;
    }
    this.engine.agc(L, R, n);
  }

  snapshot() {
    if (!this.native) {
      return this.engine.snapshot().map((s) => ({ ...s, src: s.busy ? CH_NAMES[s.ch] || '' : '' }));
    }
    const Rg = this.R;
    return [0, 1, 2].map((ch) => {
      const tp = Math.max(1, Rg[ch * 2] | ((Rg[ch * 2 + 1] & 15) << 8));
      const f = this.clock / (16 * tp);
      const vr = Rg[8 + ch];
      const on = !(Rg[7] & (1 << ch)) || !(Rg[7] & (8 << ch));
      const lvl = on && !this.engine.mutes[ch] ? (vr & 16 ? .8 : (vr & 15) / 15) : 0;
      return { label: 'AY', busy: lvl > 0, note: Math.round(69 + 12 * Math.log2(f / 440)), ch, drum: !(Rg[7] & (8 << ch)) && (Rg[7] & (1 << ch)) ? 'noise' : null, lvl, src: lvl ? CH_NAMES[ch] : '' };
    });
  }
}

return { ZX_RATE, ZXPlayer };
})();

// ---- regplay.js ----
const __m_regplay_js = (() => {
// VGM から取り出したチャンネルごとの音程・音量を、選んだ音源チップで鳴らし直す
const { Engine, waveTable } = __m_engine_js;
const FRAME_HZ_VGM = 60;
const { HIT_CLASSES } = __m_vgmin_js;
const GM_DRUM = { kick: 36, snare: 38, hat: 42, tom: 45, crash: 49, perc: 56, ohat: 46, ride: 51, clap: 39 };

class RegPlayer {
  constructor(sr) {
    this.sr = sr;
    this.engine = new Engine(sr);
    this.src = null; this.fi = 0; this.pos = 0; this.frameLeft = 0; this.hitIdx = 0;
    this.playing = false; this.loop = false; this.ended = false; this.duration = 0;
    this.map = new Map(); // ボイス番号 → エンジンのチャンネル
  }
  setChip(id, scale) { this.engine.setChip(id, scale); this.map.clear(); this.noiseSlot = null; }
  snapshot() {
    const names = this.src ? this.src.voices : [];
    return this.engine.snapshot().map((s, i) => {
      const c = this.engine.chans[i];
      return { ...s, src: s.busy ? (c.voice !== undefined && names[c.voice] ? names[c.voice].name : s.drum ? 'ドラム' : '') : '' };
    });
  }
  load(src) { this.src = src; this.duration = src.count / FRAME_HZ_VGM; this.engine.resetLevel(); this.seek(0); }
  seek(sec) {
    this.engine.reset();
    this.map.clear(); this.noiseSlot = null;
    this.fi = Math.max(0, Math.min(this.src ? this.src.count : 0, Math.floor(sec * FRAME_HZ_VGM)));
    this.pos = Math.round(this.fi / FRAME_HZ_VGM * this.sr);
    this.frameLeft = 0; this.ended = false;
    const h = this.src ? this.src.hits : [];
    this.hitIdx = 0;
    while (this.hitIdx < h.length && h[this.hitIdx] < this.fi) this.hitIdx += 3;
  }

  release(c) {
    if (!c) return;
    if (c.kind === 'fm') this.engine.release(c); else { c.busy = false; c.amp = 0; }
    c.voice = undefined;
  }

  // 1 フレーム分: 鳴っているボイスを空いているチャンネルに割り当てる
  applyFrame() {
    const e = this.engine, s = this.src, nv = s.voices.length, D = s.data, o0 = this.fi * nv * 3;
    const pool = e.melPool;
    const mutes = e.mutes, tones = e.tones;
    // 前フレームから続いている割り当てを確認
    const want = [];
    let noiseVol = 0, noiseOnset = false;
    for (let v = 0; v < nv; v++) {
      const o = o0 + v * 3, freq = D[o], vol = D[o + 1], fl = D[o + 2];
      const kind = s.voices[v].kind;
      if (kind === 'noise') {
        if (!mutes[v] && fl & 1 && vol > .02) { if (vol > noiseVol) noiseVol = vol; if (fl & 2) noiseOnset = true; }
        continue;
      }
      const on = !mutes[v] && fl & 1 && vol > .02 && freq > 25 && freq < 12000;
      const c = this.map.get(v);
      if (!on) { if (c) { this.release(c); this.map.delete(v); } continue; }
      if (c && (c.voice !== v || (c.drum && c.busy))) this.map.delete(v); // ドラムに取られた
      want.push({ v, freq, vol, onset: (fl & 2) !== 0 });
    }
    // 割り当て (新しいボイスは空きチャンネル → 一番小さい音のボイスから奪う)
    const used = new Set(this.map.values());
    want.sort((a, b) => b.vol - a.vol);
    for (const w of want) {
      let c = this.map.get(w.v);
      let fresh = false;
      if (!c) {
        c = pool.find((x) => !used.has(x) && !(x.drum && x.busy));
        if (!c) {
          // 一番静かな割り当てを奪う
          let q = null, qv = w.vol;
          for (const [vv, cc] of this.map) {
            const cur = want.find((x) => x.v === vv);
            const vol = cur ? cur.vol : 0;
            if (vol < qv) { qv = vol; q = vv; }
          }
          if (q === null) continue;
          c = this.map.get(q); this.map.delete(q);
        }
        used.add(c); this.map.set(w.v, c); fresh = true;
      }
      const note = Math.round(69 + 12 * Math.log2(w.freq / 440));
      const key = tones[w.v] || (note < 48 ? 'bass' : 'lead');
      if (fresh || w.onset || !c.busy || c.toneKey !== key) {
        if (fresh || w.onset || c.kind !== 'fm' || !c.busy) { e.start(c, 0, note, 1, key); }
        c.direct = true;
      }
      c.voice = w.v; c.note = note; c.busy = true; c.released = false; c.midiCh = 0;
      if (c.kind === 'psg') { c.toneOn = true; c.noiseOn = false; }
      if (c.kind === 'wave') { c.noiseOn = false; c.table = waveTable(key, c.g.bits); }
      e.applyPitchVol(c, w.freq, Math.min(1, w.vol * (c.kind === 'fm' ? 1 : .5)));
    }
    // ノイズ
    const nc = this.findNoiseChan();
    if (nc) {
      if (nc.kind === 'pcm') { if (noiseOnset && noiseVol) e.drumOnClass(nc, 'snare', noiseVol); }
      else if (noiseVol) {
        if (!nc.busy || !nc.direct) { e.start(nc, 0, 60, 1, 'lead'); nc.direct = true; }
        nc.busy = true; nc.drum = null; nc.voice = undefined;
        nc.toneOn = false; nc.noiseOn = true; nc.nInc = 12000 / this.sr;
        e.applyPitchVol(nc, 0, noiseVol);
      } else if (nc.busy && nc.direct) { nc.busy = false; nc.amp = 0; }
    }
    // リズム音源・PCM ドラム
    const h = s.hits;
    while (this.hitIdx < h.length && h[this.hitIdx] <= this.fi) {
      const cls = HIT_CLASSES[h[this.hitIdx + 1]];
      if (!mutes[nv]) e.drumOn(GM_DRUM[cls] || 38, Math.round(h[this.hitIdx + 2] / 100 * 110));
      this.hitIdx += 3;
    }
  }

  findNoiseChan() {
    if (this.noiseSlot && this.engine.chans.includes(this.noiseSlot)) return this.noiseSlot;
    const e = this.engine;
    const cands = e.chans.filter((c) => !e.melPool.includes(c) || c.g.role === 'both');
    this.noiseSlot = cands.slice().reverse().find((c) => (c.kind === 'psg' && (c.g.noiseOnly || c.g.noise)) || (c.kind === 'wave' && c.g.noise))
      || cands.find((c) => c.kind === 'pcm') || null;
    return this.noiseSlot;
  }

  process(L, R, n) {
    const fl = this.sr / FRAME_HZ_VGM;
    let off = 0;
    while (n > 0) {
      if (this.playing && this.frameLeft <= 0) {
        if (this.fi >= this.src.count) {
          if (this.loop) this.seek(0);
          else { this.playing = false; this.ended = true; for (const c of this.map.values()) this.release(c); this.map.clear(); }
        }
        if (this.playing) { this.applyFrame(); this.fi++; this.frameLeft += fl; }
      }
      const seg = this.playing ? Math.min(n, Math.max(1, Math.ceil(this.frameLeft))) : n;
      this.engine.render(L, R, off, seg);
      off += seg; n -= seg;
      if (this.playing) { this.pos += seg; this.frameLeft -= seg; }
    }
    this.engine.master(L, R, L.length);
  }
}

return { RegPlayer };
})();

// ---- worklet.js ----
const __m_worklet_js = (() => {
const { Player } = __m_engine_js;
const { ZXPlayer } = __m_zx_js;
const { RegPlayer } = __m_regplay_js;
// 再生する曲の種類 (MIDI / ZX) に応じてプレイヤーを差し替える
const FADE = Math.round(sampleRate * 0.012);

class ChipProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cfg = { chip: 'ym2612', scale: 1, mutes: new Array(64).fill(false), tones: new Array(64).fill(null), loop: false };
    this.player = this.make('midi');
    this.tick = 0;
    this.port.onmessage = (ev) => {
      const m = ev.data, cfg = this.cfg;
      let p = this.player;
      switch (m.type) {
        case 'load':
          this.loadId = m.id || 0;
          p = this.player = this.make(m.zx ? 'zx' : m.reg ? 'reg' : 'midi');
          if (m.zx) p.load(m.zx.frames, m.zx.count, m.zx.clock); else if (m.reg) p.load(m.reg); else p.load(m.events, m.duration);
          p.playing = false; this.muted = false; this.fade = 0;
          break;
        case 'play': if (p.ended) p.seek(0); p.playing = true; this.muted = false; this.fade = 0; this.fadeIn = FADE; break;
        // 一時停止: 余韻を残さず、約 12ms で消して無音にする (急に切るとプツッと鳴るので短くフェード)
        case 'pause': p.playing = false; if (!this.muted) this.fade = FADE; break;
        case 'seek': p.seek(m.time); break;
        case 'loop': cfg.loop = p.loop = m.value; break;
        case 'chip': cfg.chip = m.id; cfg.scale = m.scale; p.setChip(m.id, m.scale); break;
        case 'mutes': cfg.mutes = m.value; p.engine.setMutes(m.value); break;
        case 'tones': cfg.tones = m.value; p.engine.setTones(m.value); break;
      }
    };
  }
  make(type) {
    const p = type === 'zx' ? new ZXPlayer(sampleRate) : type === 'reg' ? new RegPlayer(sampleRate) : new Player(sampleRate);
    const c = this.cfg;
    p.setChip(c.chip, c.scale); p.engine.setMutes(c.mutes); p.engine.setTones(c.tones); p.loop = c.loop;
    return p;
  }
  process(_in, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    L.fill(0); if (R !== L) R.fill(0);
    if (!this.muted) {
      this.player.process(L, R, L.length);
      // 一時停止のフェードアウト → 終わったら全チャンネルを止めて無音に
      if (this.fade > 0) {
        for (let i = 0; i < L.length; i++) {
          const g = Math.max(0, this.fade - i) / FADE;
          L[i] *= g; if (R !== L) R[i] *= g;
        }
        this.fade -= L.length;
        if (this.fade <= 0) { this.fade = 0; this.muted = true; this.player.engine.silence(); }
      } else if (this.fadeIn > 0) {
        for (let i = 0; i < L.length; i++) {
          const g = 1 - Math.max(0, this.fadeIn - i) / FADE;
          L[i] *= g; if (R !== L) R[i] *= g;
        }
        this.fadeIn = Math.max(0, this.fadeIn - L.length);
      }
    }
    if ((this.tick += L.length) >= 2048) {
      this.tick = 0;
      const p = this.player;
      this.port.postMessage({ type: 'status', id: this.loadId || 0, time: p.pos / sampleRate, playing: p.playing, ended: p.ended, chans: p.snapshot() });
    }
    return true;
  }
}
registerProcessor('chip-player', ChipProcessor);

return {  };
})();
