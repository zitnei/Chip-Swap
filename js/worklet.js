import { Player } from './engine.js';
import { ZXPlayer } from './zx.js';
import { RegPlayer } from './regplay.js';

// 再生する曲の種類 (MIDI / ZX) に応じてプレイヤーを差し替える
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
          p = this.player = this.make(m.zx ? 'zx' : m.reg ? 'reg' : 'midi');
          if (m.zx) p.load(m.zx.frames, m.zx.count, m.zx.clock); else if (m.reg) p.load(m.reg); else p.load(m.events, m.duration);
          p.playing = false;
          break;
        case 'play': if (p.ended) p.seek(0); p.playing = true; break;
        case 'pause': p.playing = false; p.engine.allOff(); break;
        case 'seek': p.seek(m.time); break;
        case 'loop': cfg.loop = p.loop = m.value; break;
        case 'chip': cfg.chip = m.id; cfg.scale = m.scale; p.setChip(m.id, m.scale); break;
        case 'mutes': cfg.mutes = m.value; p.engine.setMutes(m.value); break;
        case 'tones': cfg.tones = m.value; p.engine.setTones(m.value); break;
      }
    };
  }
  make(type) {
    const p = type === 'zx' ? new ZXPlayer(sampleRate) : type === 'reg' ? new RegPlayer(sampleRate) : new Player(sampleRate);
    const c = this.cfg;
    p.setChip(c.chip, c.scale); p.engine.setMutes(c.mutes); p.engine.setTones(c.tones); p.loop = c.loop;
    return p;
  }
  process(_in, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    L.fill(0); if (R !== L) R.fill(0);
    this.player.process(L, R, L.length);
    if ((this.tick += L.length) >= 2048) {
      this.tick = 0;
      const p = this.player;
      this.port.postMessage({ type: 'status', time: p.pos / sampleRate, playing: p.playing, ended: p.ended, chans: p.snapshot() });
    }
    return true;
  }
}
registerProcessor('chip-player', ChipProcessor);
