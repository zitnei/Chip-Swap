// VGM から取り出したチャンネルごとの音程・音量を、選んだ音源チップで鳴らし直す
import { Engine, waveTable } from './engine.js';
const FRAME_HZ_VGM = 60;
const VOICE_FAMS = ['lead', 'piano', 'strings', 'brass', 'guitar', 'bell', 'organ', 'reed', 'pad'];
import { HIT_CLASSES } from './vgmin.js';

const GM_DRUM = { kick: 36, snare: 38, hat: 42, tom: 45, crash: 49, perc: 56, ohat: 46, ride: 51, clap: 39 };

export class RegPlayer {
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
      // ゲームの音色を使う時は、元のチャンネルごとにそのゲームの色々な音色を割り当てる
      const key = tones[w.v] || e.mapTone(note < 48 ? 'bass' : e.toneMap ? VOICE_FAMS[w.v % VOICE_FAMS.length] : 'lead');
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
