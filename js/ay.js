// ZX スペクトラム / アムストラッド CPC の .ay (ZXAYEMUL) ファイル
// Z80 で付属の再生プログラムを 50Hz で動かし、AY レジスタの状態をフレームごとに記録する
import { Z80 } from './z80.js';

export const ZX_CLOCK = 1773400;
export const CPC_CLOCK = 1000000;
const FRAME_T = 69888;

export function isAY(buf) {
  const u = new Uint8Array(buf, 0, 8);
  return String.fromCharCode(...u) === 'ZXAYEMUL';
}

export function parseAY(buf) {
  const u = new Uint8Array(buf);
  const d = new DataView(buf);
  if (!isAY(buf)) throw new Error('.ay ファイルではありません');
  const w = (o) => d.getUint16(o);
  const rel = (o) => { const v = d.getInt16(o); return v === 0 ? -1 : o + v; };
  const str = (o) => { if (o < 0) return ''; let s = ''; for (let i = o; i < u.length && u[i]; i++) s += String.fromCharCode(u[i]); return s; };
  const author = str(rel(12)), misc = str(rel(14));
  const count = u[16] + 1, first = u[17];
  const ss = rel(18);
  const songs = [];
  for (let i = 0; i < count; i++) {
    const base = ss + i * 4;
    const name = str(rel(base));
    const sd = rel(base + 2);
    const pp = rel(sd + 10), pa = rel(sd + 12);
    const blocks = [];
    for (let o = pa; o >= 0 && o + 6 <= u.length; o += 6) {
      const addr = w(o); if (!addr) break;
      let len = w(o + 2); const off = rel(o + 4);
      if (off < 0) continue;
      len = Math.min(len, 65536 - addr, u.length - off);
      if (len > 0) blocks.push({ addr, data: u.subarray(off, off + len) });
    }
    songs.push({
      name, length: w(sd + 4), fade: w(sd + 6), hi: u[sd + 8], lo: u[sd + 9],
      stack: w(pp), init: w(pp + 2), inter: w(pp + 4), blocks,
    });
  }
  return { author, misc, songs, first };
}

// 1 曲分を実行して AY レジスタのフレーム列を作る
// 戻り値: { frames: Uint8Array(n*16) [R0..R13, R13書込フラグ, 0], count, clock }
export function runAY(song, { cpc = false, maxSec = 300 } = {}) {
  const mem = new Uint8Array(65536);
  mem.fill(0xc9, 0, 0x100); mem.fill(0xff, 0x100, 0x4000);
  mem[0x38] = 0xfb;
  for (const b of song.blocks) mem.set(b.data, b.addr);
  const init = song.init || (song.blocks[0] && song.blocks[0].addr) || 0;
  const code = song.inter
    ? [0xf3, 0xcd, init & 0xff, init >> 8, 0xed, 0x56, 0xfb, 0x76, 0xcd, song.inter & 0xff, song.inter >> 8, 0x18, 0xf7]
    : [0xf3, 0xcd, init & 0xff, init >> 8, 0xed, 0x5e, 0xfb, 0x76, 0x18, 0xfa];
  mem.set(code, 0);

  const regs = new Uint8Array(16);
  let sel = 0, ppiA = 0, envWritten = false;
  const MASK = [255, 15, 255, 15, 255, 15, 31, 255, 31, 31, 31, 255, 255, 15, 255, 255];
  const put = (r, v) => { if (r < 14) { regs[r] = v & MASK[r]; if (r === 13) envWritten = true; } };
  const io = {
    in: (port) => ((port & 0xc002) === 0xc000 ? regs[sel] : 0xff),
    out: (port, v) => {
      if (cpc) {
        const hi = port >> 8;
        if (hi === 0xf4) ppiA = v;
        else if (hi === 0xf6) { if ((v & 0xc0) === 0xc0) sel = ppiA & 15; else if ((v & 0xc0) === 0x80) put(sel, ppiA); }
      } else if ((port & 0xc002) === 0xc000) sel = v & 15;
      else if ((port & 0xc002) === 0x8000) put(sel, v);
    },
  };
  const z = new Z80(mem, io);
  z.reset();
  const rr = (song.hi << 8) | song.lo;
  for (const k of ['a', 'b', 'd', 'h', 'a_', 'b_', 'd_', 'h_']) z[k] = song.hi;
  for (const k of ['f', 'c', 'e', 'l', 'f_', 'c_', 'e_', 'l_']) z[k] = song.lo;
  z.ix = rr; z.iy = rr; z.i = song.hi; z.r = song.lo;
  z.sp = song.stack; z.pc = 0;

  // 初期化 (INIT) は時間がかかることがあるので多めに回す
  for (let t = 0; t < 50_000_000 && !z.halted;) t += z.step();

  const n = Math.min(song.length || 180 * 50, maxSec * 50);
  const frames = new Uint8Array(n * 16);
  let silent = 0, last = n;
  for (let f = 0; f < n; f++) {
    envWritten = false;
    let t = z.interrupt();
    let guard = 0;
    while (t < FRAME_T * 4 && !(z.halted && t > 0)) { t += z.step(); if (++guard > 400000) break; }
    frames.set(regs.subarray(0, 14), f * 16);
    frames[f * 16 + 14] = envWritten ? 1 : 0;
    // 曲長が書かれていないファイルは長い無音で打ち切り
    const vol = (regs[8] | regs[9] | regs[10]) & 31;
    silent = vol ? 0 : silent + 1;
    if (!song.length && silent > 50 * 5 && f > 50 * 10) { last = f - silent + 50; break; }
  }
  const count = Math.min(n, last);
  return { frames: frames.subarray(0, count * 16), count, clock: cpc ? CPC_CLOCK : ZX_CLOCK };
}
