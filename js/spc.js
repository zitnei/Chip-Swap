// スーパーファミコンの SPC (SNES-SPC700 Sound File Data)
// SPC エミュレーター (game-music-emu / snes_spc を WebAssembly にしたもの) を動かしながら、
// 8 チャンネルそれぞれの音程・音量・発音を 60Hz ごとに読み取り、parseVGM と同じ形にする。
// SNES は音色が「サンプル (録音した波形)」なので、サンプルの繰り返し部分の周期を測って実際の音の高さを求める。
import { HIT_CLASSES } from './vgmin.js';

export function isSPC(buf) {
  const u = new Uint8Array(buf, 0, Math.min(27, buf.byteLength));
  return String.fromCharCode(...u) === 'SNES-SPC700 Sound File Data';
}

// ID666 タグ (曲名・ゲーム名・長さ)
export function spcTags(buf) {
  const u = new Uint8Array(buf);
  const str = (o, n) => { let s = ''; for (let i = 0; i < n && u[o + i]; i++) s += String.fromCharCode(u[o + i]); return s.trim(); };
  const tags = { title: '', game: '', artist: '', seconds: 0, fadeMs: 0 };
  if (u[0x23] !== 26) return tags;
  tags.title = str(0x2e, 32); tags.game = str(0x4e, 32);
  // 長さは「テキスト形式」と「バイナリ形式」がある
  const lenTxt = str(0xa9, 3), fadeTxt = str(0xac, 5);
  if (/^\d+$/.test(lenTxt) || (lenTxt === '' && /^\d*$/.test(fadeTxt))) {
    tags.seconds = +lenTxt || 0; tags.fadeMs = +fadeTxt || 0; tags.artist = str(0xb1, 32);
  } else {
    tags.seconds = u[0xa9] | (u[0xaa] << 8) | (u[0xab] << 16); tags.fadeMs = u[0xac] | (u[0xad] << 8) | (u[0xae] << 16) | (u[0xaf] << 24); tags.artist = str(0xb0, 32);
  }
  if (tags.seconds > 1200) tags.seconds = 0;
  return tags;
}

// SPC エミュレーター (js/vendor/snesspc.js) をメインスレッドで読み込む
let corePromise = null;
export function loadSpcCore(url) {
  return (corePromise ??= new Promise((resolve, reject) => {
    if (globalThis.SnesSpc) return resolve();
    const s = document.createElement('script');
    s.src = url; s.onload = resolve; s.onerror = () => reject(new Error('SPC エミュレーターを読み込めませんでした'));
    document.head.append(s);
  }).then(() => globalThis.SnesSpc()));
}

// ---- BRR (SNES のサンプル圧縮) を展開 ----
// blargg の Spc_Dsp::decode_brr と同じ計算 (出力は 2 倍した 16bit)
function decodeBRR(ram, start, maxBlocks = 4000) {
  const out = [];
  let prev1 = 0, prev2 = 0, addr = start, loopFlag = false;
  for (let b = 0; b < maxBlocks; b++) {
    const h = ram[addr & 0xffff], shift = h >> 4, filter = h & 0x0c;
    for (let i = 0; i < 16; i++) {
      const byte = ram[(addr + 1 + (i >> 1)) & 0xffff];
      let n = i & 1 ? byte & 15 : byte >> 4;
      if (n >= 8) n -= 16;
      let s = shift <= 12 ? (n << shift) >> 1 : (n < 0 ? -2048 : 0);
      const p1 = prev1, p2 = prev2 >> 1;
      if (filter >= 8) {
        s += p1 - p2;
        if (filter === 8) s += (p2 >> 4) + ((p1 * -3) >> 6);
        else s += ((p1 * -13) >> 7) + ((p2 * 3) >> 4);
      } else if (filter) s += (p1 >> 1) + ((-p1) >> 5);
      s = Math.max(-32768, Math.min(32767, s));
      s = ((s * 2) << 16) >> 16;
      prev2 = prev1; prev1 = s;
      out.push(s);
    }
    addr += 9;
    if (h & 1) { loopFlag = (h & 2) !== 0; break; }
  }
  return { samples: out, loop: loopFlag };
}

// 周期 (サンプル数) を自己相関で求める。見つからなければ 0
function findPeriod(x, minLag = 6, maxLag = 1024) {
  const n = x.length;
  if (n < minLag * 3) return { period: 0, strength: 0 };
  let mean = 0; for (const v of x) mean += v; mean /= n;
  let e0 = 0; for (const v of x) e0 += (v - mean) ** 2;
  if (e0 <= 0) return { period: 0, strength: 0 };
  const lagMax = Math.min(maxLag, Math.floor(n / 2));
  const acf = new Float32Array(lagMax + 1);
  let best = 0;
  for (let lag = minLag; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (x[i] - mean) * (x[i + lag] - mean);
    acf[lag] = s / e0 * n / (n - lag);
    if (acf[lag] > best) best = acf[lag];
  }
  // 最大値の 9 割以上ある最初の山 (= 基本周期) を選ぶ
  for (let lag = minLag + 1; lag < lagMax; lag++) {
    if (acf[lag] >= best * .9 && acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1]) {
      // 放物線補間で小数点以下まで
      const a = acf[lag - 1], b = acf[lag], c = acf[lag + 1], d = a - 2 * b + c;
      return { period: lag + (d ? (a - c) / (2 * d) : 0), strength: b };
    }
  }
  return { period: 0, strength: best };
}

// サンプル (音色) を調べる: 音程のある音色なら 1 周期のサンプル数、打楽器なら種類
function analyzeSample(ram, dirAddr, srcn) {
  const e = (dirAddr + srcn * 4) & 0xffff;
  const start = ram[e] | (ram[e + 1] << 8), loopAddr = ram[e + 2] | (ram[e + 3] << 8);
  const { samples, loop } = decodeBRR(ram, start);
  const info = { start, period: 0, drum: null, len: samples.length };
  if (samples.length < 16) return info;
  let seg;
  if (loop && loopAddr >= start) {
    const ls = Math.floor((loopAddr - start) / 9) * 16;
    const body = samples.slice(Math.min(ls, samples.length - 16));
    // 繰り返し部分を 3 回つなげて周期を測る
    seg = body.length < 2048 ? [...body, ...body, ...body] : body.slice(0, 4096);
  } else {
    seg = samples.slice(Math.min(256, samples.length >> 3), Math.min(samples.length, 4096));
  }
  const { period, strength } = findPeriod(seg);
  if (period && (loop ? strength > .3 : strength > .6)) { info.period = period; return info; }
  // 打楽器: 0 をまたぐ回数 (音の高さの目安) で分類
  let zc = 0;
  const head = samples.slice(0, Math.min(samples.length, 2048));
  for (let i = 1; i < head.length; i++) if ((head[i - 1] < 0) !== (head[i] < 0)) zc++;
  const zcr = zc / head.length;
  info.drum = zcr > .3 ? (samples.length > 8000 ? 'crash' : 'hat') : zcr > .07 ? 'snare' : zcr > .025 ? 'tom' : 'kick';
  return info;
}

const NOTE_NAMES = (v) => `SNES ${v + 1}`;

// SPC を読み取って、parseVGM と同じ形 ({voices, count, data, hits, ...}) にする
export function spcToReg(M, buf, maxSec = 300) {
  const tags = spcTags(buf);
  const seconds = Math.min(maxSec, tags.seconds ? tags.seconds + Math.min(10, tags.fadeMs / 1000) : 180);
  const u8 = new Uint8Array(buf);
  const p = M._malloc(u8.length);
  M.HEAPU8.set(u8, p);
  const err = M._sp_load(p, u8.length);
  M._free(p);
  if (err) throw new Error('SPC ファイルを読み込めませんでした');
  const ramPtr = M._sp_ram();
  const nv = 9; // 8 チャンネル + ノイズ
  const voices = Array.from({ length: 8 }, (_, v) => ({ name: NOTE_NAMES(v), kind: 'psg' }));
  voices.push({ name: 'SNES ノイズ', kind: 'noise' });
  const count = Math.ceil(seconds * 60);
  const data = new Float32Array(count * nv * 3);
  const hits = [];
  const sampleCache = new Map();
  const buffer = M._malloc(600 * 4);
  let acc = 0;
  for (let f = 0; f < count; f++) {
    acc += 32000 / 60;
    const n = Math.floor(acc); acc -= n;
    M._sp_play(buffer, n * 2);
    const kon = M._sp_kon(), non = M._sp_dsp(0x3d), dir = M._sp_dsp(0x5d) << 8;
    const ram = M.HEAPU8.subarray(ramPtr, ramPtr + 0x10000);
    const o0 = f * nv * 3;
    let noiseVol = 0;
    for (let v = 0; v < 8; v++) {
      const b = v * 16;
      const envx = M._sp_dsp(b + 8);
      const vl = (M._sp_dsp(b) << 24) >> 24, vr = (M._sp_dsp(b + 1) << 24) >> 24;
      const vol = envx / 127 * Math.min(1, (Math.abs(vl) + Math.abs(vr)) / 2 / 100);
      const srcn = M._sp_dsp(b + 4);
      const key = (dir << 8) | srcn;
      let info = sampleCache.get(key);
      const e = (dir + srcn * 4) & 0xffff, start = ram[e] | (ram[e + 1] << 8);
      if (!info || info.start !== start) { info = analyzeSample(ram, dir, srcn); sampleCache.set(key, info); }
      const onset = (kon >> v) & 1;
      if (non & (1 << v)) { if (vol > noiseVol) noiseVol = vol; continue; }
      if (info.drum) {
        if (onset && vol > .02) hits.push(f, HIT_CLASSES.indexOf(info.drum), Math.round(Math.min(1, vol * 1.5) * 100));
        continue;
      }
      const pitch = M._sp_dsp(b + 2) | ((M._sp_dsp(b + 3) & 0x3f) << 8);
      const freq = info.period ? pitch / 4096 * 32000 / info.period : 0;
      const on = vol > .01 && freq > 20 && freq < 8000;
      data[o0 + v * 3] = freq;
      data[o0 + v * 3 + 1] = on ? vol : 0;
      data[o0 + v * 3 + 2] = (on ? 1 : 0) | (onset ? 2 : 0);
    }
    if (noiseVol > .01) { const o = o0 + 8 * 3; data[o + 1] = noiseVol; data[o + 2] = 1 | 4 | (kon & non ? 2 : 0); }
  }
  M._free(buffer);
  return { voices, count, data, hits: Int32Array.from(hits), chips: ['SNES S-DSP (SPC700)'], unsupported: [], duration: count / 60, tags };
}
