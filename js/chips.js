// 音色 (GM ファミリーごと) と 音源チップの定義

// env: ソフトウェアエンベロープ (60Hz フレーム単位, サウンドドライバ風)
//   a=アタック, d=ディケイ, s=サスティンレベル, sd=サスティン中の減衰(フレーム時定数), r=リリース
// vib: ディレイビブラート {delay(フレーム), depth(セント), rate(Hz)}
// fm: 4オペFMパッチ。ops = [mul, TL(dB), attack秒, decay秒, sustain(0-1), sustainDecay秒, release秒, detune(セント)]
export const TONES = {
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
export const FAMILY_TONE = ['piano', 'bell', 'organ', 'guitar', 'bass', 'strings', 'strings', 'brass',
  'reed', 'flute', 'lead', 'pad', 'pad', 'guitar', 'bell', 'lead'];

// 音源チップ定義
// groups: ハードウェアチャンネルのまとまり
//   kind: psg(矩形波+ノイズ) / tri(ファミコン三角波) / wave(波形メモリ) / fm(4オペFM) / pcm(サンプルドラム)
//   role: mel(メロディ) / drum(ドラム) / both(兼用、ドラム優先で奪う)
//   clock/div/pOff/maxP: 周波数レジスタ量子化 f = clock / (div * (P + pOff))
//   vol: 音量テーブル  bits: 波形メモリのビット数  noise: ノイズ出力可  noiseOnly: ノイズ専用
// route: ドラムの種類ごとにどのグループで鳴らすか
export const CHIPS = [
  {
    id: 'ym2612', cat: 'console', type: 'fm', maker: 'セガ', name: 'YM2612 (OPN2) + SN76489', system: 'メガドライブ',
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
    id: 'cps1', cat: 'arcade', type: 'fm', maker: 'カプコン', name: 'YM2151 (OPM) + OKI MSM6295', system: 'CPS-1 (ストリートファイターII 等)',
    desc: 'FM 4オペ 8ch + 4bit ADPCM 4ch (7.5kHz) ドラム', lpf: 9000, gain: 0.44,
    groups: [
      { name: 'fm', label: 'FM', kind: 'fm', count: 8, role: 'mel', dacBits: 10, stereo: true, gain: 0.45 },
      { name: 'oki', label: 'ADPCM', kind: 'pcm', count: 4, role: 'drum', pcm: { rate: 7575, enc: 'adpcm' }, gain: 0.8 },
    ],
    route: { default: ['oki'] },
  },
  {
    id: 'ym2610', cat: 'arcade', type: 'fm', maker: 'タイトー', name: 'YM2610 (OPNB)', system: 'F2システム / ダライアスII (ネオジオも同系)',
    desc: 'FM 4ch + SSG 3ch + ADPCM-A 6ch (18.5kHz) ドラム', lpf: 12000, gain: 0.46,
    groups: [
      { name: 'fm', label: 'FM', kind: 'fm', count: 4, role: 'mel', dacBits: 12, stereo: true, gain: 0.5 },
      { name: 'ssg', label: 'SSG', kind: 'psg', count: 3, role: 'mel', clock: 2000000, div: 16, pOff: 0, maxP: 4095, vol: 'ay', dutyFixed: true, gain: 0.22 },
      { name: 'adpcm', label: 'ADPCM-A', kind: 'pcm', count: 6, role: 'drum', pcm: { rate: 18518, enc: 'adpcm' }, stereo: true, gain: 0.8 },
    ],
    route: { default: ['adpcm'] },
  },
  {
    id: 'namcowsg', cat: 'arcade', type: 'wave', maker: 'ナムコ', name: 'WSG (3ch 波形メモリ)', system: 'パックマン / ギャラガ',
    desc: '4bit・32サンプル波形メモリ 3ch。ノイズ無しなのでドラムも波形で代用', lpf: 10000, gain: 2.0,
    groups: [
      { name: 'wsg', label: 'WSG', kind: 'wave', count: 3, role: 'both', bits: 4, vol: 'lin4', gain: 0.35 },
    ],
    route: { default: ['wsg'] },
  },
  {
    id: 'namcoc30', cat: 'arcade', type: 'wave', maker: 'ナムコ', name: 'C30 (8ch 波形メモリ)', system: 'System 86 / System 1',
    desc: '4bit 波形メモリ 8ch・ステレオ・ノイズモード付き', lpf: 12000, gain: 1.3,
    groups: [
      { name: 'c30', label: 'C30', kind: 'wave', count: 8, role: 'both', bits: 4, vol: 'lin4', noise: true, stereo: true, gain: 0.28 },
    ],
    route: { default: ['c30'] },
  },
  {
    id: 'namco15xx', cat: 'arcade', type: 'wave', maker: 'ナムコ', name: '15XX (8ch 波形メモリ)', system: 'マッピー / スーパーパックマン / ドルアーガの塔',
    desc: '4bit・32サンプル波形メモリ 8ch (モノラル・ノイズ無し)。ドラムも波形で代用', lpf: 10000, gain: 1.3,
    groups: [
      { name: 'wsg', label: '15XX', kind: 'wave', count: 8, role: 'both', bits: 4, vol: 'lin4', gain: 0.26 },
    ],
    route: { default: ['wsg'] },
  },
  {
    id: 'namcosys86', cat: 'arcade', type: 'fm', maker: 'ナムコ', name: 'YM2151 + C30', system: 'System 86 (源平討魔伝・妖怪道中記 等)',
    desc: 'FM 4オペ 8ch + 4bit 波形メモリ 8ch (ノイズ付き) のツイン音源', lpf: 11000, gain: 0.5,
    groups: [
      { name: 'fm', label: 'FM', kind: 'fm', count: 8, role: 'mel', dacBits: 10, stereo: true, gain: 0.42 },
      { name: 'c30', label: 'C30', kind: 'wave', count: 8, role: 'both', bits: 4, vol: 'lin4', noise: true, stereo: true, gain: 0.22 },
    ],
    route: { default: ['c30'] },
  },
  {
    id: 'namcosys1', cat: 'arcade', type: 'fm', maker: 'ナムコ', name: 'YM2151 + C30 + DAC', system: 'System 1 (パックマニア・ギャラガ’88・スプラッターハウス 等)',
    desc: 'FM 4オペ 8ch + 4bit 波形メモリ 8ch + 8bit DAC ドラム', lpf: 11000, gain: 0.5,
    groups: [
      { name: 'fm', label: 'FM', kind: 'fm', count: 8, role: 'mel', dacBits: 10, stereo: true, gain: 0.42 },
      { name: 'c30', label: 'C30', kind: 'wave', count: 8, role: 'mel', bits: 4, vol: 'lin4', noise: true, stereo: true, gain: 0.2 },
      { name: 'dac', label: 'DAC', kind: 'pcm', count: 2, role: 'drum', pcm: { rate: 16000, enc: 'pcm8' }, stereo: true, gain: 0.8 },
    ],
    route: { default: ['dac'] },
  },
  {
    id: 'namcosys2', cat: 'arcade', type: 'fm', maker: 'ナムコ', name: 'YM2151 + C140', system: 'System 2 (オーダイン・ワルキューレの伝説・ファイナルラップ 等)',
    desc: 'FM 4オペ 8ch + C140 PCM 8ch ドラム (21kHz)', lpf: 12000, gain: 0.5,
    groups: [
      { name: 'fm', label: 'FM', kind: 'fm', count: 8, role: 'mel', dacBits: 10, stereo: true, gain: 0.45 },
      { name: 'c140', label: 'C140', kind: 'pcm', count: 8, role: 'drum', pcm: { rate: 21390, enc: 'pcm8' }, stereo: true, gain: 0.8 },
    ],
    route: { default: ['c140'] },
  },
  {
    id: 'scc', cat: 'console', type: 'wave', maker: 'コナミ', name: 'SCC (K051649) + AY-3-8910', system: 'MSX (グラディウス2・悪魔城ドラキュラ 等)',
    desc: '8bit・32サンプル波形メモリ 5ch + PSG 3ch', lpf: 11000, gain: 1.15,
    groups: [
      { name: 'scc', label: 'SCC', kind: 'wave', count: 5, role: 'mel', bits: 8, vol: 'lin4', clock: 3579545, div: 32, pOff: 1, maxP: 4095, gain: 0.3 },
      { name: 'psg', label: 'PSG', kind: 'psg', count: 3, role: 'both', clock: 1789772, div: 16, pOff: 0, maxP: 4095, vol: 'ay', noise: true, dutyFixed: true, gain: 0.24 },
    ],
    route: { default: ['psg'] },
  },
  {
    id: 'konamiac', cat: 'arcade', type: 'wave', maker: 'コナミ', name: 'K005289 + AY-3-8910 ×2', system: 'グラディウス (アーケード)',
    desc: '4bit 波形メモリ 2ch + PSG 6ch', lpf: 10000, gain: 1.15,
    groups: [
      { name: 'k5289', label: 'K005289', kind: 'wave', count: 2, role: 'mel', bits: 4, vol: 'lin4', clock: 3579545, div: 32, pOff: 0, maxP: 4095, gain: 0.35 },
      { name: 'psg', label: 'PSG', kind: 'psg', count: 6, role: 'both', clock: 1789772, div: 16, pOff: 0, maxP: 4095, vol: 'ay', noise: true, dutyFixed: true, gain: 0.2 },
    ],
    route: { default: ['psg'] },
  },
  {
    id: 'ay8910', cat: 'both', type: 'psg', maker: '汎用 PSG', name: 'AY-3-8910 / YM2149', system: 'MSX / 各社アーケード',
    desc: '矩形波 3ch (ノイズはトーンにミックス)。ドラムは 3ch 目を奪う', lpf: 10000, gain: 1.3,
    groups: [
      { name: 'psg', label: 'PSG', kind: 'psg', count: 3, role: 'both', clock: 1789772, div: 16, pOff: 0, maxP: 4095, vol: 'ay', noise: true, dutyFixed: true, gain: 0.3 },
    ],
    route: { default: ['psg'] },
  },
  {
    id: 'zx128', cat: 'console', type: 'psg', maker: 'シンクレア', name: 'AY-3-8912', system: 'ZXスペクトラム 128',
    desc: '矩形波 3ch + ノイズ + ハードウェアエンベロープ。ZX チューンは実機どおりに再生', lpf: 10000, gain: 1.3,
    groups: [
      { name: 'psg', label: 'PSG', kind: 'psg', count: 3, role: 'both', clock: 1773400, div: 16, pOff: 0, maxP: 4095, vol: 'ay', noise: true, dutyFixed: true, gain: .3 },
    ],
    route: { default: ['psg'] },
  },
  {
    id: 'sn76489', cat: 'console', type: 'psg', maker: 'セガ', name: 'SN76489', system: 'SG-1000 / マスターシステム / ゲームギア',
    desc: '矩形波 3ch + ノイズ 1ch (最低音 約109Hz)', lpf: 10000, gain: 1.0,
    groups: [
      { name: 'sq', label: 'SQ', kind: 'psg', count: 3, role: 'mel', clock: 3579545, div: 32, pOff: 0, maxP: 1023, vol: 'sn', dutyFixed: true, gain: 0.3 },
      { name: 'nz', label: 'NOISE', kind: 'psg', count: 1, role: 'drum', noiseOnly: true, vol: 'sn', gain: 0.3 },
    ],
    route: { default: ['nz'] },
  },
  {
    id: '2a03', cat: 'console', type: 'psg', maker: '任天堂', name: '2A03 (RP2A03)', system: 'ファミコン',
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
    id: 'huc6280', cat: 'console', type: 'wave', maker: 'ハドソン / NEC', name: 'HuC6280', system: 'PCエンジン',
    desc: '5bit・32サンプル波形メモリ 6ch・ステレオ (5,6ch はノイズ可)', lpf: 13000, gain: 1.4,
    groups: [
      { name: 'w', label: 'WAVE', kind: 'wave', count: 4, role: 'mel', bits: 5, vol: 'huc', clock: 3579545, div: 32, pOff: 0, maxP: 4095, stereo: true, gain: 0.28 },
      { name: 'wn', label: 'WAVE/N', kind: 'wave', count: 2, role: 'both', bits: 5, vol: 'huc', clock: 3579545, div: 32, pOff: 0, maxP: 4095, noise: true, stereo: true, gain: 0.28 },
    ],
    route: { default: ['wn'] },
  },
];

// ドラム (GM ch10) の分類
export function drumClass(n) {
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
export const DRUMS = {
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
