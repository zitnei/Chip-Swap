// WAV / VGM 書き出し (別スレッドでオフラインレンダリング)
import { Player } from './engine.js';
import { ZXPlayer } from './zx.js';
import { buildVGM } from './vgm.js';

onmessage = (ev) => {
  try {
    if (ev.data.format === 'vgm') {
      const bytes = buildVGM(ev.data);
      postMessage({ type: 'done', blob: new Blob([bytes], { type: 'application/octet-stream' }) });
    } else postMessage({ type: 'done', blob: renderWav(ev.data) });
  } catch (e) { postMessage({ type: 'error', message: e.message }); }
};

function renderWav({ events, duration, zx, chip, scale, mutes, tones, sr }) {
  const p = zx ? new ZXPlayer(sr) : new Player(sr);
  p.setChip(chip, scale);
  p.engine.setMutes(mutes);
  p.engine.setTones(tones);
  if (zx) { p.load(zx.frames, zx.count, zx.clock); duration = p.duration; } else p.load(events, duration);
  p.playing = true;
  const total = Math.ceil((duration + 2) * sr);
  const pcm = new Int16Array(total * 2);
  const B = 4096;
  const L = new Float32Array(B), R = new Float32Array(B);
  let done = 0, lastReport = 0;
  while (done < total) {
    L.fill(0); R.fill(0);
    p.process(L, R, B);
    const n = Math.min(B, total - done);
    for (let i = 0; i < n; i++) {
      pcm[(done + i) * 2] = L[i] * 32767;
      pcm[(done + i) * 2 + 1] = R[i] * 32767;
    }
    done += n;
    if (done - lastReport > sr * 5) { lastReport = done; postMessage({ type: 'progress', value: done / total }); }
  }
  const header = new ArrayBuffer(44);
  const d = new DataView(header);
  const w = (o, s) => { for (let i = 0; i < 4; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); d.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVE');
  w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 2, true);
  d.setUint32(24, sr, true); d.setUint32(28, sr * 4, true); d.setUint16(32, 4, true); d.setUint16(34, 16, true);
  w(36, 'data'); d.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm.buffer], { type: 'audio/wav' });
}
