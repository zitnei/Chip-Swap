import { Player } from './engine.js';
import { ZXPlayer } from './zx.js';
import { RegPlayer } from './regplay.js';
import { TONES } from './chips.js';

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
        // ゲームから取り出した音色 (キー → 音色) と、ファミリー → 音色キーの対応
        case 'toneset': Object.assign(TONES, m.tones || {}); cfg.toneMap = m.map || null; p.engine.setToneMap(cfg.toneMap); break;
      }
    };
  }
  make(type) {
    const p = type === 'zx' ? new ZXPlayer(sampleRate) : type === 'reg' ? new RegPlayer(sampleRate) : new Player(sampleRate);
    const c = this.cfg;
    p.setChip(c.chip, c.scale); p.engine.setMutes(c.mutes); p.engine.setTones(c.tones); p.engine.setToneMap(c.toneMap); p.loop = c.loop;
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
