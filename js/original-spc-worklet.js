// 「元の音源で聴く」(スーパーファミコン SPC) 用の AudioWorklet。
// game-music-emu (blargg の snes_spc) を WebAssembly にしたもので、SPC をそのまま鳴らす。
// js/vendor/snesspc.js と 1 ファイルにまとめて使う (tools/build-worklet.mjs が js/original-spc-worklet.bundle.js を作る)。
/* global SnesSpc */

const SPC_RATE = 32000;

class SpcProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.M = null; this.dataPtr = 0; this.inBuf = 0; this.inCap = 0;
    this.playing = false; this.ended = false; this.loadId = 0; this.tick = 0;
    this.pos = 0; this.seconds = 0; this.fade = 0; this.duration = 0;
    this.queue = [];
    this.port.onmessage = (e) => (this.M ? this.handle(e.data) : this.queue.push(e.data));
    SnesSpc().then((M) => {
      this.M = M;
      for (const m of this.queue) this.handle(m);
      this.queue = [];
    }).catch((err) => this.port.postMessage({ type: 'error', message: String(err && err.message || err) }));
  }

  handle(m) {
    switch (m.type) {
      case 'load': {
        this.loadId = m.id;
        const M = this.M, data = new Uint8Array(m.data);
        if (this.dataPtr) M._free(this.dataPtr);
        this.dataPtr = M._malloc(data.length);
        M.HEAPU8.set(data, this.dataPtr);
        this.size = data.length;
        this.seconds = m.seconds || 180; this.fade = (m.fadeMs || 0) / 1000;
        this.duration = this.seconds + this.fade;
        if (!this.restart(0)) { this.port.postMessage({ type: 'error', id: m.id, message: 'この SPC は読み込めませんでした' }); return; }
        this.playing = !!m.play;
        this.port.postMessage({ type: 'loaded', id: m.id, chips: ['SNES S-DSP (SPC700)'], duration: this.duration });
        break;
      }
      case 'play': if (this.ended) this.restart(0); this.playing = true; break;
      case 'pause': this.playing = false; break;
      case 'seek': this.restart(m.time); break;
    }
  }

  // 最初から読み込み直して、sec 秒まで早送り
  restart(sec) {
    const M = this.M;
    if (M._sp_load(this.dataPtr, this.size)) return false;
    const skip = Math.floor(sec * SPC_RATE) * 2;
    if (skip > 0) M._sp_skip(skip);
    this.pos = Math.floor(sec * SPC_RATE); this.avail = 0; this.rp = 0; this.ended = false;
    return true;
  }

  process(_in, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    if (!this.M || !this.playing || !this.dataPtr) { L.fill(0); if (R !== L) R.fill(0); return true; }
    const M = this.M, step = SPC_RATE / sampleRate;
    // 32kHz のサンプルを貯めておき、正確な位置から直線補間で読み出す (ブラウザのサンプルレートに合わせる)
    if (!this.fifoL) { this.fifoL = new Float32Array(8192); this.fifoR = new Float32Array(8192); this.avail = 0; this.rp = 0; }
    const CH = 256;
    while (this.avail - this.rp < n * step + 2) {
      if (this.inCap < CH) { this.inBuf = M._malloc(CH * 4); this.inCap = CH; }
      M._sp_play(this.inBuf, CH * 2);
      const h = M.HEAP16, o = this.inBuf >> 1;
      for (let i = 0; i < CH; i++) { this.fifoL[this.avail + i] = h[o + i * 2] / 32768; this.fifoR[this.avail + i] = h[o + i * 2 + 1] / 32768; }
      this.avail += CH;
    }
    const FL = this.fifoL, FR = this.fifoR;
    let rp = this.rp;
    for (let i = 0; i < n; i++) {
      const k = rp | 0, t = rp - k;
      const sec = (this.pos + rp) / SPC_RATE;
      // 曲の終わりはフェードアウト
      const g = sec > this.seconds && this.fade ? Math.max(0, 1 - (sec - this.seconds) / this.fade) : 1;
      L[i] = (FL[k] + (FL[k + 1] - FL[k]) * t) * g;
      if (R !== L) R[i] = (FR[k] + (FR[k + 1] - FR[k]) * t) * g;
      rp += step;
    }
    const used = rp | 0;
    FL.copyWithin(0, used, this.avail); FR.copyWithin(0, used, this.avail);
    this.avail -= used; this.rp = rp - used; this.pos += used;
    if (this.pos / SPC_RATE >= this.duration) { this.playing = false; this.ended = true; }
    if ((this.tick += n) >= 4096 || this.ended) {
      this.tick = 0;
      this.port.postMessage({ type: 'status', id: this.loadId, time: Math.min(this.pos / SPC_RATE, this.duration), duration: this.duration, playing: this.playing, ended: this.ended });
    }
    return true;
  }
}
registerProcessor('spc-player', SpcProcessor);
