// ZX チューン (AY レジスタのフレーム列) の再生
//  - 'zx128' を選んだ時: AY-3-8912 をそのままエミュレート (ハードウェアエンベロープ込み)
//  - 他の音源を選んだ時: AY の 3ch + ノイズを、そのチップのチャンネルに割り当てて鳴らし直す
import { Engine, waveTable } from './engine.js';

export const ZX_RATE = 50;
const AYVOL = [0, .0137, .0205, .0291, .0423, .0618, .0847, .1369, .1691, .2647, .3527, .4499, .5704, .6873, .8482, 1];
const CH_NAMES = ['AY A', 'AY B', 'AY C', 'NOISE'];

export class ZXPlayer {
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
      const key = e.tones[ch] || e.mapTone('lead');
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
