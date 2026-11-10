// 「元の音源で聴く」用の AudioWorklet。
// VGM を libvgm (chiptune.app / Chip Player JS と同じエミュレーター) でそのまま鳴らす。
// js/vendor/libvgm.js と 1 ファイルにまとめて使う (tools/build-worklet.mjs が js/original-worklet.bundle.js を作る)。
/* global LibVGM */

const GAIN = 3 / 0x8000000; // libvgm の出力 (32bit 整数) を -1〜1 に。少し持ち上げる

class LibVGMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.M = null; this.ctx = 0; this.buf = 0; this.cap = 0;
    this.playing = false; this.ended = false; this.loadId = 0; this.tick = 0; this.duration = 0;
    this.queue = [];
    this.port.onmessage = (e) => (this.M ? this.handle(e.data) : this.queue.push(e.data));
    LibVGM().then((M) => {
      this.M = M;
      this.ctx = M._lvgm_init(sampleRate);
      for (const m of this.queue) this.handle(m);
      this.queue = [];
    }).catch((err) => this.port.postMessage({ type: 'error', message: String(err && err.message || err) }));
  }

  handle(m) {
    const M = this.M;
    switch (m.type) {
      case 'load': {
        this.loadId = m.id;
        const data = new Uint8Array(m.data);
        const p = M._malloc(data.length);
        M.HEAPU8.set(data, p);
        const err = M._lvgm_load_data(this.ctx, p, data.length);
        M._free(p);
        if (err !== 0) { this.port.postMessage({ type: 'error', id: m.id, message: 'この VGM は読み込めませんでした (code ' + err + ')' }); return; }
        M._lvgm_start(this.ctx);
        this.duration = M._lvgm_get_duration_ms(this.ctx) / 1000;
        const chips = [];
        const n = M._lvgm_get_voice_count(this.ctx);
        for (let i = 0; i < n; i++) {
          const c = M.UTF8ToString(M._lvgm_get_voice_chip_name(this.ctx, i));
          if (!chips.includes(c)) chips.push(c);
        }
        this.ended = false; this.playing = !!m.play;
        this.port.postMessage({ type: 'loaded', id: m.id, chips, duration: this.duration });
        break;
      }
      case 'play': if (this.ended) { this.M._lvgm_seek_ms(this.ctx, 0); this.ended = false; } this.playing = true; break;
      case 'pause': this.playing = false; break;
      case 'seek': this.M._lvgm_seek_ms(this.ctx, Math.max(0, Math.round(m.time * 1000))); this.ended = false; break;
    }
  }

  process(_in, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    if (!this.M || !this.playing) { L.fill(0); if (R !== L) R.fill(0); return true; }
    const M = this.M;
    if (this.cap < n) { if (this.buf) M._free(this.buf); this.buf = M._malloc(n * 8); this.cap = n; }
    const written = M._lvgm_render(this.ctx, this.buf, n);
    if (written === 0) {
      L.fill(0); if (R !== L) R.fill(0);
      this.playing = false; this.ended = true;
    } else {
      const h = M.HEAP32, o = this.buf >> 2;
      for (let i = 0; i < n; i++) {
        let l = h[o + i * 2] * GAIN, r = h[o + i * 2 + 1] * GAIN;
        L[i] = l > 1 ? 1 : l < -1 ? -1 : l;
        if (R !== L) R[i] = r > 1 ? 1 : r < -1 ? -1 : r;
      }
    }
    if ((this.tick += n) >= 4096 || this.ended) {
      this.tick = 0;
      this.port.postMessage({ type: 'status', id: this.loadId, time: M._lvgm_get_position_ms(this.ctx) / 1000, duration: this.duration, playing: this.playing, ended: this.ended });
    }
    return true;
  }
}
registerProcessor('libvgm-player', LibVGMProcessor);
