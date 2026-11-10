// VGM 書き出し: エンジンを 60Hz フレーム単位で動かし、各チャンネルの状態を
// 実機チップのレジスタ書き込みに変換して VGM 1.71 ファイルにする
import { Player, drumRaw, DRUM_CLASSES } from './engine.js';
import { TONES } from './chips.js';
import { ZXPlayer } from './zx.js';

const SR = 44100;
const FRAME = 735; // 44100 / 60

// VGM で書き出せる音源 (ナムコ WSG / C30・K005289 は VGM 形式に対応チップが無い)
export const VGM_SUPPORTED = ['ym2612', 'cps1', 'ym2610', 'scc', 'ay8910', 'zx128', 'sn76489', '2a03', 'huc6280'];

class Out {
  constructor() { this.b = []; }
  u8(...v) { for (const x of v) this.b.push(x & 0xff); }
  u16(v) { this.u8(v, v >> 8); }
  u32(v) { this.u8(v, v >> 8, v >> 16, v >>> 24); }
  bytes(a) { for (const x of a) this.b.push(x & 0xff); }
  wait(n) {
    while (n > 0) {
      if (n === 735) { this.u8(0x62); return; }
      const k = Math.min(n, 65535); this.u8(0x61); this.u16(k); n -= k;
    }
  }
  dataBlock(type, data) { this.u8(0x67, 0x66, type); this.u32(data.length); this.bytes(data); }
}

// ---------- 共通ヘルパー ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// OKI / ADPCM-A 方式の 4bit ADPCM エンコード (上位ニブルが先)
const STEPS = [16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552];
const IDX_ADJ = [-1, -1, -1, -1, 2, 4, 6, 8];
function adpcmEncode(x, gain = .8) {
  const nib = [];
  let sig = 0, idx = 0;
  for (let i = 0; i < x.length; i++) {
    const target = Math.round(x[i] * gain * 2047);
    const step = STEPS[idx];
    const diff = target - sig;
    const sign = diff < 0 ? 8 : 0;
    const q = clamp(Math.round((Math.abs(diff) * 8 / step - 1) / 2), 0, 7);
    const d = ((q * 2 + 1) * step) >> 3;
    sig = clamp(sig + (sign ? -d : d), -2048, 2047);
    idx = clamp(idx + IDX_ADJ[q], 0, 48);
    nib.push(sign | q);
  }
  if (nib.length & 1) nib.push(0);
  const out = new Uint8Array(nib.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (nib[i * 2] << 4) | nib[i * 2 + 1];
  return out;
}

// FM エンベロープの秒数 → レート値 (0-31)
function decayRate(t, egHz) {
  if (!(t > 0)) return 31;
  const X = (t * 96 / 60) * egHz * 1.25 / 1024;
  return clamp(Math.round(2 * (11 - Math.log2(X))), 1, 31);
}
function attackRate(t, egHz) {
  if (!(t > 0)) return 31;
  const X = (t * 9) * egHz * 1.25 / 1024;
  return clamp(Math.round(2 * (11 - Math.log2(X))), 1, 31);
}
function fmOpRegs(d, egHz, vel, isCarrier, att) {
  const [mul, tl, a, dcy, sl, d2, rr, dt] = d;
  let tlv = tl;
  if (!isCarrier) tlv -= 20 * Math.log10(.55 + .45 * vel);
  let TL = Math.round(tlv / .75) + (isCarrier ? att : 0);
  const D1L = sl >= 1 ? 0 : sl <= 0 ? 15 : clamp(Math.round(-20 * Math.log10(sl) / 3), 0, 15);
  const DT = dt > 6 ? 3 : dt > 3 ? 2 : dt > 0 ? 1 : dt < -6 ? 7 : dt < -3 ? 6 : dt < 0 ? 5 : 0;
  return {
    MUL: mul < 1 ? 0 : clamp(Math.round(mul), 1, 15), DT, TL: clamp(TL, 0, 127),
    AR: attackRate(a, egHz), D1R: dcy > 0 ? decayRate(dcy, egHz) : 31, D2R: d2 > 0 ? decayRate(d2, egHz) : 0,
    D1L, RR: clamp(Math.round((decayRate(rr, egHz) - 1) / 2), 0, 15),
  };
}
const CARRIERS = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];

// ---------- PSG 系 ----------
function snWriter(o, chans) {
  const last = chans.map(() => ({ P: -1, vol: -1 }));
  let noiseMode = -1;
  const w = (v) => o.u8(0x50, v);
  return () => {
    let ti = 0;
    chans.forEach((c, k) => {
      const L = last[k];
      if (c.g.noiseOnly) {
        const vol = c.busy ? c.volQ : 0;
        if (c.busy) {
          const f = c.nInc * SR;
          const mode = 4 | (f >= 20000 ? 0 : f >= 7000 ? 1 : 2);
          if (mode !== noiseMode || c.age !== L.age) { w(0xe0 | mode); noiseMode = mode; }
        }
        L.age = c.age;
        if (vol !== L.vol) { w(0xf0 | (15 - vol)); L.vol = vol; }
        return;
      }
      const ch = ti++;
      const vol = c.busy ? c.volQ : 0;
      if (c.busy && c.P !== L.P) { w(0x80 | (ch << 5) | (c.P & 15)); w((c.P >> 4) & 0x3f); L.P = c.P; }
      if (vol !== L.vol) { w(0x90 | (ch << 5) | (15 - vol)); L.vol = vol; }
    });
  };
}

function ayWriter(write, chans, clock) {
  const last = chans.map(() => ({ P: -1, vol: -1 }));
  let mixer = -1, np = -1;
  write(7, 0x3f);
  return () => {
    let mix = 0x3f;
    chans.forEach((c, ch) => {
      const L = last[ch];
      const on = c.busy && c.volQ > 0;
      if (on && c.toneOn) mix &= ~(1 << ch);
      if (on && c.noiseOn) {
        mix &= ~(8 << ch);
        const p = clamp(Math.round(clock / 16 / (c.nInc * SR)), 1, 31);
        if (p !== np) { write(6, p); np = p; }
      }
      if (on && c.toneOn && c.P !== L.P) { write(ch * 2, c.P & 0xff); write(ch * 2 + 1, (c.P >> 8) & 15); L.P = c.P; }
      const vol = on ? c.volQ : 0;
      if (vol !== L.vol) { write(8 + ch, vol); L.vol = vol; }
    });
    if (mix !== mixer) { write(7, mix | 0xc0); mixer = mix; }
  };
}

// ---------- FM (OPN2 / OPNB / OPM) ----------
function opnWriter(write, chans, { hwChans, egHz, clock }) {
  const SLOT = [0, 8, 4, 12];
  const last = chans.map(() => ({ age: -1, on: false, tone: null, fnum: -1, att: -1, pan: -1 }));
  const fnumOf = (f) => {
    for (let b = 0; b < 8; b++) {
      const fn = Math.round(f * 144 * (1 << 20) / clock / (1 << Math.max(0, b - 1)) / (b === 0 ? 2 : 1));
      if (fn < 2048) return (b << 11) | fn;
    }
    return (7 << 11) | 2047;
  };
  return () => {
    chans.forEach((c, i) => {
      const hw = hwChans[i], port = hw < 3 ? 0 : 1, off = hw % 3, key = hw < 3 ? hw : hw + 1;
      const L = last[i];
      if (c.age !== L.age && c.busy) {
        L.age = c.age;
        if (L.on) write(0, 0x28, key);
        const p = TONES[c.toneKey].fm;
        const car = CARRIERS[p.alg];
        p.ops.forEach((d, k) => {
          const r = fmOpRegs(d, egHz, c.vel, car.includes(k), c.fmAtt);
          const a = SLOT[k] + off;
          write(port, 0x30 + a, (r.DT << 4) | r.MUL);
          write(port, 0x40 + a, r.TL);
          write(port, 0x50 + a, r.AR);
          write(port, 0x60 + a, r.D1R);
          write(port, 0x70 + a, r.D2R);
          write(port, 0x80 + a, (r.D1L << 4) | r.RR);
          write(port, 0x90 + a, 0);
        });
        write(port, 0xb0 + off, (p.fb << 3) | p.alg);
        const pan = (c.gl > 0 ? 0x80 : 0) | (c.gr > 0 ? 0x40 : 0);
        write(port, 0xb4 + off, pan); L.pan = pan;
        const fn = fnumOf(c.freq);
        write(port, 0xa4 + off, fn >> 8); write(port, 0xa0 + off, fn & 0xff); L.fnum = fn;
        L.att = c.fmAtt; L.tone = c.toneKey;
        write(0, 0x28, 0xf0 | key); L.on = true;
        return;
      }
      if (L.on && (!c.busy || c.released)) { write(0, 0x28, key); L.on = false; }
      if (L.on) {
        const fn = fnumOf(c.freq);
        if (fn !== L.fnum) { write(port, 0xa4 + off, fn >> 8); write(port, 0xa0 + off, fn & 0xff); L.fnum = fn; }
        if (c.fmAtt !== L.att) {
          const p = TONES[c.toneKey].fm;
          for (const k of CARRIERS[p.alg]) write(port, 0x40 + SLOT[k] + off, fmOpRegs(p.ops[k], egHz, c.vel, true, c.fmAtt).TL);
          L.att = c.fmAtt;
        }
      }
    });
  };
}

function opmWriter(write, chans, egHz) {
  const SLOT = [0, 16, 8, 24];
  const NOTE = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];
  const last = chans.map(() => ({ age: -1, on: false, kc: -1, att: -1 }));
  const kcOf = (f) => {
    const m = 69 + 12 * Math.log2(f / 440) - 13;
    let o = Math.floor(m / 12), r = m - o * 12;
    if (o < 0) { o = 0; r = 0; } if (o > 7) { o = 7; r = 11.98; }
    const k = Math.floor(r);
    return { kc: (o << 4) | NOTE[k], kf: clamp(Math.floor((r - k) * 64), 0, 63) };
  };
  return () => {
    chans.forEach((c, ch) => {
      const L = last[ch];
      if (c.age !== L.age && c.busy) {
        L.age = c.age;
        if (L.on) write(0x08, ch);
        const p = TONES[c.toneKey].fm, car = CARRIERS[p.alg];
        p.ops.forEach((d, k) => {
          const r = fmOpRegs(d, egHz, c.vel, car.includes(k), c.fmAtt);
          const a = SLOT[k] + ch;
          write(0x40 + a, (r.DT << 4) | r.MUL);
          write(0x60 + a, r.TL);
          write(0x80 + a, r.AR);
          write(0xa0 + a, r.D1R);
          write(0xc0 + a, r.D2R);
          write(0xe0 + a, (r.D1L << 4) | r.RR);
        });
        const pan = (c.gl > 0 ? 0x40 : 0) | (c.gr > 0 ? 0x80 : 0);
        write(0x20 + ch, pan | (p.fb << 3) | p.alg);
        const { kc, kf } = kcOf(c.freq);
        write(0x28 + ch, kc); write(0x30 + ch, kf << 2); L.kc = kc * 64 + kf;
        L.att = c.fmAtt;
        write(0x08, 0x78 | ch); L.on = true;
        return;
      }
      if (L.on && (!c.busy || c.released)) { write(0x08, ch); L.on = false; }
      if (L.on) {
        const { kc, kf } = kcOf(c.freq);
        if (kc * 64 + kf !== L.kc) { write(0x28 + ch, kc); write(0x30 + ch, kf << 2); L.kc = kc * 64 + kf; }
        if (c.fmAtt !== L.att) {
          const p = TONES[c.toneKey].fm;
          for (const k of CARRIERS[p.alg]) write(0x60 + SLOT[k] + ch, fmOpRegs(p.ops[k], egHz, c.vel, true, c.fmAtt).TL);
          L.att = c.fmAtt;
        }
      }
    });
  };
}

// ---------- 波形メモリ系 ----------
const waveBytes = (t, bits) => Array.from(t, (v) => Math.round((v + 1) / 2 * ((1 << bits) - 1)));

function sccWriter(o, chans) {
  const w = (port, a, d) => o.u8(0xd2, port, a, d);
  const last = chans.map(() => ({ P: -1, vol: -1, table: null }));
  const waveOwner = [null, null, null, null];
  let keys = -1;
  return () => {
    let mask = 0;
    chans.forEach((c, ch) => {
      const L = last[ch];
      const on = c.busy && c.volQ > 0;
      if (on) mask |= 1 << ch;
      const wch = Math.min(ch, 3); // 4ch と 5ch は波形を共有
      if (on && c.table && waveOwner[wch] !== c.table) {
        waveBytes(c.table, 8).forEach((v, i) => w(0, wch * 32 + i, (v - 128) & 0xff));
        waveOwner[wch] = c.table;
      }
      if (on && c.P !== L.P) { w(1, ch * 2, c.P & 0xff); w(1, ch * 2 + 1, (c.P >> 8) & 15); L.P = c.P; }
      const vol = on ? c.volQ : 0;
      if (vol !== L.vol) { w(2, ch, vol); L.vol = vol; }
    });
    if (mask !== keys) { w(3, 0, mask); keys = mask; }
  };
}

function hucWriter(o, chans) {
  const w = (a, d) => o.u8(0xb9, a, d);
  w(0x01, 0xff); w(0x09, 0x00);
  chans.forEach((_, ch) => { w(0x00, ch); w(0x05, 0xff); w(0x04, 0x00); w(0x07, 0x00); });
  const last = chans.map(() => ({ P: -1, ctl: -1, table: null, noise: -1, bal: -1 }));
  return () => {
    chans.forEach((c, ch) => {
      const L = last[ch];
      const on = c.busy && c.volQ > 0;
      let sel = false;
      const S = () => { if (!sel) { w(0x00, ch); sel = true; } };
      if (on && !c.noiseOn && c.table && L.table !== c.table) {
        S(); w(0x04, 0x40); w(0x04, 0x00);
        for (const v of waveBytes(c.table, 5)) w(0x06, v);
        L.table = c.table; L.ctl = 0;
      }
      if (on && !c.noiseOn && c.P !== L.P) { S(); w(0x02, c.P & 0xff); w(0x03, (c.P >> 8) & 15); L.P = c.P; }
      const noise = on && c.noiseOn ? 0x80 | clamp(31 - Math.round(3579545 / 64 / (c.nInc * SR)), 0, 31) : 0;
      if (ch >= 4 && noise !== L.noise) { S(); w(0x07, noise); L.noise = noise; }
      if (on) {
        const bal = (clamp(Math.round(c.gl / 1.414 * 15), 0, 15) << 4) | clamp(Math.round(c.gr / 1.414 * 15), 0, 15);
        if (bal !== L.bal) { S(); w(0x05, bal); L.bal = bal; }
      }
      const ctl = on ? 0x80 | c.volQ : 0x00;
      if (ctl !== L.ctl) { S(); w(0x04, ctl); L.ctl = ctl; }
    });
  };
}

// ---------- ファミコン APU ----------
function nesWriter(o, chans) {
  const w = (reg, d) => o.u8(0xb4, reg - 0x4000, d);
  const NOISE_P = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
  // DPCM サンプル (kick / tom) を $C000 から配置
  const dpcm = {}; const ram = [];
  for (const cls of ['kick', 'tom']) {
    const x = drumRaw(cls, 24858);
    const bits = []; let lvl = 64;
    for (const v of x) { const t = (v * .5 + .5) * 127; if (t > lvl && lvl <= 125) { bits.push(1); lvl += 2; } else { bits.push(0); if (lvl >= 2) lvl -= 2; } }
    let n = Math.ceil(bits.length / 8); n = Math.min(4081, Math.ceil((n - 1) / 16) * 16 + 1);
    const start = ram.length;
    for (let i = 0; i < n; i++) { let b = 0; for (let k = 0; k < 8; k++) b |= (bits[i * 8 + k] || 0) << k; ram.push(b); }
    while (ram.length % 64) ram.push(0x55);
    dpcm[cls] = { addr: start / 64, len: (n - 1) / 16 };
  }
  o.dataBlock(0xc2, [0x00, 0xc0, ...ram]);
  w(0x4015, 0x0f); w(0x4017, 0x40); w(0x4001, 0x08); w(0x4005, 0x08); w(0x4010, 0x0e);
  const last = chans.map(() => ({ P: -1, hi: -1, vol: -1, age: -1, on: false, mode: -1 }));
  return () => {
    let pulse = 0;
    chans.forEach((c, k) => {
      const L = last[k];
      if (c.kind === 'psg' && !c.g.noiseOnly) {
        const base = 0x4000 + 4 * pulse++;
        const vol = c.busy ? c.volQ : 0;
        const duty = c.duty <= .125 ? 0 : c.duty <= .25 ? 1 : c.duty <= .5 ? 2 : 3;
        const r0 = (duty << 6) | 0x30 | vol;
        if (r0 !== L.vol) { w(base, r0); L.vol = r0; }
        if (c.busy && c.P !== L.P) {
          w(base + 2, c.P & 0xff);
          if ((c.P >> 8) !== L.hi) { w(base + 3, 0xf8 | (c.P >> 8)); L.hi = c.P >> 8; }
          L.P = c.P;
        }
      } else if (c.kind === 'tri') {
        const on = c.busy && c.amp > 0;
        if (on && c.P !== L.P) { w(0x400a, c.P & 0xff); if ((c.P >> 8) !== L.hi) { w(0x400b, 0xf8 | (c.P >> 8)); L.hi = c.P >> 8; } L.P = c.P; }
        if (on !== L.on) { w(0x4008, on ? 0xff : 0x80); if (on && L.hi < 0) { w(0x400b, 0xf8 | (c.P >> 8)); L.hi = c.P >> 8; } L.on = on; }
      } else if (c.g.noiseOnly) {
        const vol = c.busy ? c.volQ : 0;
        if (c.busy && c.age !== L.age) {
          const f = c.nInc * SR;
          let idx = 0, bd = Infinity;
          NOISE_P.forEach((p, i) => { const d = Math.abs(Math.log(1789773 / p / f)); if (d < bd) { bd = d; idx = i; } });
          const mode = (c.short ? 0x80 : 0) | idx;
          if (mode !== L.mode) { w(0x400e, mode); L.mode = mode; }
          w(0x400f, 0xf8);
        }
        L.age = c.age;
        if ((0x30 | vol) !== L.vol) { w(0x400c, 0x30 | vol); L.vol = 0x30 | vol; }
      } else if (c.kind === 'pcm') {
        if (c.age !== L.age && c.busy && dpcm[c.drumCls]) {
          const s = dpcm[c.drumCls];
          w(0x4015, 0x0f); w(0x4011, 0x40); w(0x4012, s.addr); w(0x4013, s.len); w(0x4015, 0x1f);
        }
        L.age = c.age;
      }
    });
  };
}

// ---------- PCM ドラム (メガドライブ DAC / OKI / ADPCM-A) ----------
function ym2612Dac(o, chan) {
  const rate = 13000;
  const data = []; const map = {};
  for (const cls of DRUM_CLASSES) {
    const x = drumRaw(cls, rate);
    map[cls] = { off: data.length, len: x.length };
    for (const v of x) data.push(clamp(Math.round(v * 127 + 128), 0, 255));
  }
  o.dataBlock(0x00, data);
  o.u8(0x52, 0x2b, 0x80); o.u8(0x53, 0xb6, 0xc0);
  o.u8(0x90, 0, 0x02, 0x00, 0x2a); o.u8(0x91, 0, 0x00, 0x01, 0x00);
  o.u8(0x92, 0); o.u32(rate);
  let age = -1, lastRate = rate;
  return () => {
    const c = chan;
    if (c.age !== age && c.busy && c.drumCls) {
      const s = map[c.drumCls];
      const r = Math.round(rate * (c.drumCls === 'tom' ? Math.pow(2, (c.note - 45) / 18) : 1));
      if (r !== lastRate) { o.u8(0x92, 0); o.u32(r); lastRate = r; }
      o.u8(0x93, 0); o.u32(s.off); o.u8(0x01); o.u32(s.len);
    }
    age = c.age;
  };
}

function buildRom(enc, rate, align, tableSize) {
  const rom = new Array(tableSize).fill(0); const map = {};
  for (const cls of DRUM_CLASSES) {
    while (rom.length % align) rom.push(0);
    const bytes = adpcmEncode(drumRaw(cls, rate));
    map[cls] = { start: rom.length, end: rom.length + bytes.length - 1 };
    for (const b of bytes) rom.push(b);
  }
  while (rom.length % align) rom.push(0x80);
  return { rom, map };
}
function romBlock(o, type, romSize, rom) {
  o.u8(0x67, 0x66, type); o.u32(rom.length + 8); o.u32(romSize); o.u32(0); o.bytes(rom);
}

function okiWriter(o, chans) {
  const { rom, map } = buildRom('adpcm', 7575, 1, 0x400);
  DRUM_CLASSES.forEach((cls, i) => {
    const e = (i + 1) * 8, s = map[cls];
    rom[e] = s.start >> 16; rom[e + 1] = s.start >> 8; rom[e + 2] = s.start;
    rom[e + 3] = s.end >> 16; rom[e + 4] = s.end >> 8; rom[e + 5] = s.end;
  });
  romBlock(o, 0x8b, 0x40000, rom);
  const ATT = [0, -3.2, -6, -9.2, -12, -14.5, -18, -24, -30];
  const ages = chans.map(() => -1);
  return () => {
    chans.forEach((c, k) => {
      if (c.age !== ages[k] && c.busy && c.drumCls) {
        const db = 20 * Math.log10(Math.max(1e-3, c.amp));
        let a = 0, bd = Infinity; ATT.forEach((x, i) => { if (Math.abs(x - db) < bd) { bd = Math.abs(x - db); a = i; } });
        o.u8(0xb8, 0, 0x08 << k); // 停止してから
        o.u8(0xb8, 0, 0x80 | (DRUM_CLASSES.indexOf(c.drumCls) + 1));
        o.u8(0xb8, 0, (0x10 << k) | a);
      }
      ages[k] = c.age;
    });
  };
}

function adpcmAWriter(write, o, chans) {
  const { rom, map } = buildRom('adpcm', 18518, 256, 0);
  romBlock(o, 0x82, 0x100000, rom);
  write(1, 0x01, 0x3f);
  const ages = chans.map(() => -1);
  return () => {
    chans.forEach((c, k) => {
      if (c.age !== ages[k] && c.busy && c.drumCls) {
        const s = map[c.drumCls];
        const lvl = clamp(Math.round(31 + 20 * Math.log10(Math.max(1e-3, c.amp)) / .75), 0, 31);
        const pan = (c.gl > 0 ? 0x80 : 0) | (c.gr > 0 ? 0x40 : 0);
        write(1, 0x00, 0x80 | (1 << k));
        write(1, 0x08 + k, pan | lvl);
        write(1, 0x10 + k, (s.start >> 8) & 0xff); write(1, 0x18 + k, s.start >> 16);
        write(1, 0x20 + k, (s.end >> 8) & 0xff); write(1, 0x28 + k, s.end >> 16);
        write(1, 0x00, 1 << k);
      }
      ages[k] = c.age;
    });
  };
}

// ---------- ZX チューン → AY そのまま (レジスタを完全に再現) ----------
function zxRawWriter(o, p, mutes, H, clock) {
  H.ay = clock;
  const last = new Int16Array(14).fill(-1);
  return () => {
    const fi = p.fi - 1;
    if (fi < 0 || p.ended) { for (let ch = 0; ch < 3; ch++) if (last[8 + ch] !== 0) { o.u8(0xa0, 8 + ch, 0); last[8 + ch] = 0; } return; }
    const F = p.frames, base = fi * 16;
    for (let r = 0; r < 14; r++) {
      let v = F[base + r];
      if (r >= 8 && r <= 10 && mutes[r - 8]) v = 0;
      if (r === 7 && mutes[3]) v |= 0x38;
      if (r === 13) { if (F[base + 14]) { o.u8(0xa0, 13, v); last[13] = v; } continue; }
      if (v !== last[r]) { o.u8(0xa0, r, v); last[r] = v; }
    }
  };
}

// ---------- チップごとの組み立て ----------
function setupChip(id, o, eng, H) {
  const grp = (n) => eng.chans.filter((c) => c.g.name === n);
  switch (id) {
    case 'sn76489':
      H.sn = 3579545;
      return [snWriter(o, [...grp('sq'), ...grp('nz')])];
    case 'ay8910':
      H.ay = 1789772;
      return [ayWriter((r, d) => o.u8(0xa0, r, d), grp('psg'), 1789772)];
    case 'zx128':
      H.ay = 1773400;
      return [ayWriter((r, d) => o.u8(0xa0, r, d), grp('psg'), 1773400)];
    case 'scc':
      H.ay = 1789772; H.scc = 1789772;
      return [sccWriter(o, grp('scc')), ayWriter((r, d) => o.u8(0xa0, r, d), grp('psg'), 1789772)];
    case '2a03':
      H.nes = 1789772;
      return [nesWriter(o, [...grp('pulse'), ...grp('tri'), ...grp('noise'), ...grp('dpcm')])];
    case 'huc6280':
      H.huc = 3579545;
      return [hucWriter(o, [...grp('w'), ...grp('wn')])];
    case 'ym2612': {
      H.ym2612 = 7670453; H.sn = 3579545;
      const wr = (port, r, d) => o.u8(0x52 + port, r, d);
      return [
        ym2612Dac(o, grp('dac')[0]),
        opnWriter(wr, grp('fm'), { hwChans: [0, 1, 2, 3, 4], egHz: 7670453 / 144 / 3, clock: 7670453 }),
        snWriter(o, [...grp('psg'), ...grp('nz')]),
      ];
    }
    case 'cps1':
      H.ym2151 = 3579545; H.oki = 1000000 | 0x80000000;
      return [opmWriter((r, d) => o.u8(0x54, r, d), grp('fm'), 3579545 / 64 / 3), okiWriter(o, grp('oki'))];
    case 'ym2610': {
      H.ym2610 = 8000000;
      const wr = (port, r, d) => o.u8(0x58 + port, r, d);
      return [
        adpcmAWriter(wr, o, grp('adpcm')),
        opnWriter(wr, grp('fm'), { hwChans: [1, 2, 4, 5], egHz: 8000000 / 144 / 3, clock: 8000000 }),
        ayWriter((r, d) => wr(0, r, d), grp('ssg'), 2000000),
      ];
    }
  }
  throw new Error('この音源は VGM 形式に対応していません');
}

function gd3(title, game, system) {
  const strs = [title, '', game, '', system, '', '', '', '', 'Chip Swap', 'Converted from MIDI'];
  const body = [];
  for (const s of strs) { for (const ch of s) { const c = ch.charCodeAt(0); body.push(c & 0xff, c >> 8); } body.push(0, 0); }
  const o = new Out();
  o.bytes([0x47, 0x64, 0x33, 0x20]); o.u32(0x100); o.u32(body.length); o.bytes(body);
  return o.b;
}

export function buildVGM({ events, duration, zx, chip, mutes, tones, title, game, system }) {
  const p = zx ? new ZXPlayer(SR) : new Player(SR);
  const eng = p.engine;
  if (zx) p.setChip(chip, 1); else eng.setChip(chip, 1);
  eng.setMutes(mutes); eng.setTones(tones);
  if (zx) p.load(zx.frames, zx.count, zx.clock); else p.load(events, duration);
  p.playing = true;
  const frameLen = zx ? SR / 50 : FRAME;

  const o = new Out();
  const H = {};
  const writers = zx && chip === 'zx128' ? [zxRawWriter(o, p, mutes, H, zx.clock)] : setupChip(chip, o, eng, H);
  const total = zx ? zx.count + 25 : Math.ceil((duration + 2) * SR / FRAME);
  const L = new Float32Array(frameLen), R = new Float32Array(frameLen);
  for (let f = 0; f < total; f++) {
    p.process(L, R, frameLen); // エンジンを1フレーム進める (音声は使わない)
    L.fill(0); R.fill(0);
    for (const w of writers) w();
    o.wait(frameLen);
  }
  o.u8(0x66);

  const data = o.b;
  const g = gd3(title || '', game || '', system || '');
  const hdr = new DataView(new ArrayBuffer(0x100));
  const size = 0x100 + data.length + g.length;
  [0x56, 0x67, 0x6d, 0x20].forEach((b, i) => hdr.setUint8(i, b));
  hdr.setUint32(0x04, size - 4, true);
  hdr.setUint32(0x08, 0x171, true);
  hdr.setUint32(0x0c, H.sn || 0, true);
  hdr.setUint32(0x14, 0x100 + data.length - 0x14, true);
  hdr.setUint32(0x18, total * frameLen, true);
  hdr.setUint32(0x24, zx ? 50 : 60, true);
  if (H.sn) { hdr.setUint16(0x28, 0x0009, true); hdr.setUint8(0x2a, 16); }
  hdr.setUint32(0x2c, H.ym2612 || 0, true);
  hdr.setUint32(0x30, H.ym2151 || 0, true);
  hdr.setUint32(0x34, 0x100 - 0x34, true);
  hdr.setUint32(0x4c, H.ym2610 || 0, true);
  hdr.setUint32(0x74, H.ay || 0, true);
  if (H.ay) hdr.setUint8(0x79, 0x01);
  hdr.setUint32(0x84, H.nes || 0, true);
  hdr.setUint32(0x98, H.oki || 0, true);
  hdr.setUint32(0x9c, H.scc || 0, true);
  hdr.setUint32(0xa4, H.huc || 0, true);

  const out = new Uint8Array(size);
  out.set(new Uint8Array(hdr.buffer), 0);
  out.set(data, 0x100);
  out.set(g, 0x100 + data.length);
  return out;
}
