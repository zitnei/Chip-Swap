// 音源エンジン: MIDI イベントを選んだチップのハードウェアチャンネルに割り当てて合成する
import { TONES, FAMILY_TONE, CHIPS, drumClass, DRUMS } from './chips.js';

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
export function waveTable(key, bits) {
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
export const DRUM_CLASSES = ['kick', 'snare', 'clap', 'hat', 'ohat', 'crash', 'ride', 'tom', 'perc'];
export function drumRaw(cls, rate) {
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

export class Engine {
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
        X[i] = dc > 1 ? 1 : dc < -1 ? -1 : dc;
      }
      this.lp1[ch] = y1; this.lp2[ch] = y2; this.dc[ch] = dc; this.dcIn[ch] = px;
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
export class Player {
  constructor(sr) {
    this.sr = sr;
    this.engine = new Engine(sr);
    this.events = []; this.idx = 0; this.pos = 0; this.playing = false; this.loop = false; this.duration = 0; this.ended = false;
  }
  snapshot() { return this.engine.snapshot(); }
  setChip(id, scale) { this.engine.setChip(id, scale); }
  load(events, duration) { this.events = events; this.duration = duration; this.seek(0); }
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
