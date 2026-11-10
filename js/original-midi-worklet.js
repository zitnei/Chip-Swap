// 「元の音源で聴く」(MIDI) 用の AudioWorklet。
// FluidLite と chiptune.app と同じ SoundFont で、MIDI をそのまま鳴らす。
// js/vendor/fluidlite.js と 1 ファイルにまとめて使う (tools/build-worklet.mjs が js/original-midi-worklet.bundle.js を作る)。
/* global FluidLite */

class FluidProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.M = null; this.buf = 0; this.cap = 0;
    this.events = []; this.idx = 0; this.pos = 0; this.duration = 0;
    this.playing = false; this.ended = false; this.loadId = 0; this.tick = 0; this.hasFont = false;
    this.queue = [];
    this.port.onmessage = (e) => (this.M ? this.handle(e.data) : this.queue.push(e.data));
    FluidLite().then((M) => {
      this.M = M;
      M._fw_init(sampleRate);
      for (const m of this.queue) this.handle(m);
      this.queue = [];
    }).catch((err) => this.port.postMessage({ type: 'error', message: String(err && err.message || err) }));
  }

  handle(m) {
    const M = this.M;
    switch (m.type) {
      case 'soundfont': {
        M.FS.writeFile('/sf.sf2', new Uint8Array(m.data));
        const p = M.stringToNewUTF8('/sf.sf2');
        const id = M._fw_load_soundfont(p);
        M._free(p);
        try { M.FS.unlink('/sf.sf2'); } catch {}
        M._fw_drums_on_ch10();
        M._fw_set_reverb(0.33);
        this.hasFont = id >= 0;
        this.port.postMessage({ type: 'soundfont', ok: this.hasFont, name: m.name });
        break;
      }
      case 'load':
        this.loadId = m.id;
        this.events = m.events; this.duration = m.duration;
        this.seek(0);
        this.playing = !!m.play;
        this.port.postMessage({ type: 'loaded', id: m.id, duration: this.duration });
        break;
      case 'play': if (this.ended) this.seek(0); this.playing = true; break;
      case 'pause': this.playing = false; M._fw_panic(); break;
      case 'seek': this.seek(m.time); break;
    }
  }

  // 位置を変える: 音を止め、その位置までのプログラム・コントロール・ベンドだけを反映
  seek(sec) {
    const M = this.M;
    M._fw_panic(); M._fw_reset(); M._fw_drums_on_ch10(); M._fw_set_reverb(0.33);
    let i = 0;
    for (; i < this.events.length && this.events[i].t < sec; i++) {
      const e = this.events[i];
      if (e.type !== 'on' && e.type !== 'off') this.send(e);
    }
    this.idx = i; this.pos = Math.round(sec * sampleRate); this.ended = false;
  }

  send(e) {
    const M = this.M;
    switch (e.type) {
      case 'on': M._fw_note_on(e.ch, e.a, e.b); break;
      case 'off': M._fw_note_off(e.ch, e.a); break;
      case 'cc': M._fw_control_change(e.ch, e.a, e.b); break;
      case 'pc': M._fw_program_change(e.ch, e.a); break;
      case 'pb': M._fw_pitch_bend(e.ch, e.a + 8192); break;
    }
  }

  process(_in, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    const M = this.M;
    if (!M || !this.hasFont || !this.playing) { L.fill(0); if (R !== L) R.fill(0); return true; }
    const now = this.pos / sampleRate;
    while (this.idx < this.events.length && this.events[this.idx].t <= now) this.send(this.events[this.idx++]);
    if (this.cap < n) { if (this.buf) M._free(this.buf); this.buf = M._malloc(n * 8); this.cap = n; }
    M._fw_render(this.buf, n);
    const h = M.HEAPF32, o = this.buf >> 2;
    for (let i = 0; i < n; i++) {
      const l = h[o + i * 2], r = h[o + i * 2 + 1];
      L[i] = l > 1 ? 1 : l < -1 ? -1 : l;
      if (R !== L) R[i] = r > 1 ? 1 : r < -1 ? -1 : r;
    }
    this.pos += n;
    // 最後のイベントから 2 秒 (残響) で終わり
    if (this.idx >= this.events.length && now > this.duration + 2) { this.playing = false; this.ended = true; M._fw_panic(); }
    if ((this.tick += n) >= 4096 || this.ended) {
      this.tick = 0;
      this.port.postMessage({ type: 'status', id: this.loadId, time: Math.min(now, this.duration), duration: this.duration, playing: this.playing, ended: this.ended });
    }
    return true;
  }
}
registerProcessor('fluid-player', FluidProcessor);
