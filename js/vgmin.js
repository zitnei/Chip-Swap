// VGM ファイルの読み込み: 音源チップへの命令から、各チャンネルの音程・音量・発音を 60Hz ごとに取り出す
// 結果: {
//   voices: [{ name, kind: 'fm'|'psg'|'noise' }],
//   count: フレーム数, data: Float32Array(count * voices * 3) [周波数Hz, 音量0-1, フラグ(1=鳴っている, 2=このフレームで発音, 4=ノイズ)]
//   hits: Int32Array [frame, drumClassIndex, velocity*100, ...]  (リズム音源・PCM ドラムの発音)
//   chips: 使われているチップ名, unsupported: 読み取れないチップ名, duration
// }
export const FRAME = 735; // 44100 / 60
export const HIT_CLASSES = ['kick', 'snare', 'hat', 'tom', 'crash', 'perc', 'ohat', 'ride', 'clap'];
const HIT = Object.fromEntries(HIT_CLASSES.map((c, i) => [c, i]));

export function isVGM(buf) {
  const u = new Uint8Array(buf, 0, 4);
  return (u[0] === 0x56 && u[1] === 0x67 && u[2] === 0x6d && u[3] === 0x20) || (u[0] === 0x1f && u[1] === 0x8b);
}

export async function unpackVGM(buf) {
  const u = new Uint8Array(buf);
  if (u[0] !== 0x1f || u[1] !== 0x8b) return buf;
  const ds = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(ds).arrayBuffer();
}

const db = (att) => Math.pow(10, -att / 20);
const OPM_NOTE = [0, 1, 2, 2, 3, 4, 5, 5, 6, 7, 8, 8, 9, 10, 11, 11];

export function parseVGM(buf) {
  const d = new DataView(buf);
  const u = new Uint8Array(buf);
  if (d.getUint32(0, true) !== 0x206d6756) throw new Error('VGM ファイルではありません');
  const ver = d.getUint32(8, true);
  const dataStart = ver >= 0x150 && d.getUint32(0x34, true) ? 0x34 + d.getUint32(0x34, true) : 0x40;
  const hdr = (o, minVer) => (ver >= minVer && o + 4 <= dataStart ? d.getUint32(o, true) : 0);

  const voices = [];
  const chips = [], unsupported = [];
  const add = (name, kind) => { voices.push({ name, kind }); return voices.length - 1; };
  // 各ボイスの現在の状態
  let st = [];
  const mk = () => ({ freq: 0, vol: 0, on: false, onset: false, noise: false });
  const handlers = {}; // コマンド番号 → (a, b) => void
  const hits = [];
  let frame = 0;
  const hit = (cls, vel = 1) => hits.push(frame, HIT[cls], Math.round(vel * 100));

  // ---------- SN76489 ----------
  const sn = (clock, idx, cmd) => {
    const base = voices.length;
    for (let i = 0; i < 3; i++) add(`SN76489${idx ? '#2' : ''} ${i + 1}`, 'psg');
    add(`SN76489${idx ? '#2' : ''} ノイズ`, 'noise');
    const per = [0, 0, 0], att = [15, 15, 15, 15];
    let latch = 0;
    const upd = (ch) => {
      const v = st[base + ch];
      v.vol = att[ch] >= 15 ? 0 : db(att[ch] * 2);
      v.on = v.vol > 0;
      if (ch < 3) v.freq = clock / (32 * Math.max(1, per[ch]));
      else { v.noise = true; v.freq = 0; }
    };
    handlers[cmd] = (a) => {
      if (a & 0x80) {
        latch = (a >> 4) & 7;
        const ch = latch >> 1;
        if (latch & 1) { const was = att[ch]; att[ch] = a & 15; if (att[ch] < was - 2 && was >= 8) st[base + ch].onset = true; upd(ch); }
        else if (ch < 3) { per[ch] = (per[ch] & 0x3f0) | (a & 15); upd(ch); }
      } else {
        const ch = latch >> 1;
        if (latch & 1) { att[ch] = a & 15; upd(ch); }
        else if (ch < 3) { per[ch] = (per[ch] & 15) | ((a & 0x3f) << 4); upd(ch); }
      }
    };
  };

  // ---------- AY8910 / OPN の SSG 部 ----------
  const ssg = (name, toneClock) => {
    const base = voices.length;
    for (let i = 0; i < 3; i++) add(`${name} ${'ABC'[i]}`, 'psg');
    const nz = add(`${name} ノイズ`, 'noise');
    const R = new Uint8Array(16);
    const upd = () => {
      let nv = 0;
      for (let ch = 0; ch < 3; ch++) {
        const v = st[base + ch];
        const vr = R[8 + ch];
        const vol = vr & 16 ? 13 : vr & 15;
        const tone = !(R[7] & (1 << ch)), noise = !(R[7] & (8 << ch));
        const was = v.vol;
        v.vol = tone && vol ? db((15 - vol) * 3) : 0;
        v.freq = toneClock / (16 * Math.max(1, R[ch * 2] | ((R[ch * 2 + 1] & 15) << 8)));
        v.on = v.vol > 0;
        if (v.vol > was * 1.9 && v.vol > .2) v.onset = true;
        if (noise && vol) nv = Math.max(nv, db((15 - vol) * 3));
      }
      const n = st[nz];
      if (nv > n.vol * 1.9 && nv > .2) n.onset = true;
      n.vol = nv; n.on = nv > 0; n.noise = true;
    };
    return (r, v) => { if (r < 14) { R[r] = v; upd(); } };
  };

  // ---------- OPN (YM2203 / YM2608 / YM2610 / YM2612) ----------
  const opn = (name, clock, presc, nch, chanMap) => {
    const base = voices.length;
    const vids = [];
    for (let i = 0; i < nch; i++) vids.push(add(`${name} FM${i + 1}`, 'fm'));
    const fn = new Array(6).fill(0), blk = new Array(6).fill(0), hi = [0, 0], alg = new Array(6).fill(0);
    const tl = Array.from({ length: 6 }, () => [127, 127, 127, 127]);
    const CAR = [[3], [3], [3], [3], [2, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
    const vidOf = (hwch) => { const k = chanMap.indexOf(hwch); return k < 0 ? -1 : base + k; };
    const upd = (hw) => {
      const id = vidOf(hw); if (id < 0) return;
      const v = st[id];
      v.freq = fn[hw] * clock * Math.pow(2, blk[hw] - 1) / (presc * 1048576);
      v.vol = db(Math.min(...CAR[alg[hw]].map((k) => tl[hw][k])) * .75);
    };
    return (port, r, val) => {
      if (port === 0 && r === 0x28) {
        const c = val & 7; const hw = c >= 4 ? c - 1 : c;
        const id = vidOf(hw); if (id < 0) return;
        const on = (val & 0xf0) !== 0;
        if (on) st[id].onset = true;
        st[id].on = on; upd(hw);
        return;
      }
      if (r < 0x30) return;
      const c = r & 3; if (c === 3) return;
      const hw = c + port * 3;
      if (r >= 0x40 && r < 0x50) { tl[hw][(r >> 2) & 3] = val & 127; upd(hw); }
      else if (r >= 0xa4 && r < 0xa7) hi[port] = val;
      else if (r >= 0xa0 && r < 0xa3) { fn[hw] = ((hi[port] & 7) << 8) | val; blk[hw] = (hi[port] >> 3) & 7; upd(hw); }
      else if (r >= 0xb0 && r < 0xb3) { alg[hw] = val & 7; upd(hw); }
    };
  };

  // ---------- OPM (YM2151) ----------
  const opm = (clock, idx, cmd) => {
    const base = voices.length;
    for (let i = 0; i < 8; i++) add(`YM2151${idx ? '#2' : ''} ${i + 1}`, 'fm');
    const kc = new Array(8).fill(0), kf = new Array(8).fill(0), alg = new Array(8).fill(0);
    const tl = Array.from({ length: 8 }, () => [127, 127, 127, 127]);
    const CAR = [[3], [3], [3], [3], [2, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
    const upd = (ch) => {
      const v = st[base + ch];
      const midi = 12 * ((kc[ch] >> 4) & 7) + OPM_NOTE[kc[ch] & 15] + 13 + kf[ch] / 64;
      v.freq = 440 * Math.pow(2, (midi - 69) / 12) * clock / 3579545;
      v.vol = db(Math.min(...CAR[alg[ch]].map((k) => tl[ch][k])) * .75);
    };
    handlers[cmd] = (r, val) => {
      if (r === 0x08) { const ch = val & 7; const on = (val & 0x78) !== 0; if (on) st[base + ch].onset = true; st[base + ch].on = on; upd(ch); }
      else if (r >= 0x20 && r < 0x28) { alg[r & 7] = val & 7; upd(r & 7); }
      else if (r >= 0x28 && r < 0x30) { kc[r & 7] = val; upd(r & 7); }
      else if (r >= 0x30 && r < 0x38) { kf[r & 7] = val >> 2; upd(r & 7); }
      else if (r >= 0x60 && r < 0x80) { tl[r & 7][(r - 0x60) >> 3] = val & 127; upd(r & 7); }
    };
  };

  // ---------- OPL (YM3812 / YM3526 / Y8950 / YMF262) ----------
  const OPL_OP = [0, 1, 2, 8, 9, 10, 16, 17, 18];
  const opl = (name, rate, nport, cmds) => {
    const base = voices.length;
    for (let i = 0; i < 9 * nport; i++) add(`${name} ${i + 1}`, 'fm');
    const fn = new Array(18).fill(0), blk = new Array(18).fill(0), con = new Array(18).fill(0);
    const tl = Array.from({ length: 18 }, () => [63, 63]);
    let rhythm = 0, rbits = 0;
    const upd = (c) => {
      const v = st[base + c];
      v.freq = fn[c] * rate / Math.pow(2, 20 - blk[c]);
      v.vol = db((con[c] ? Math.min(tl[c][0], tl[c][1]) : tl[c][1]) * .75);
    };
    cmds.forEach((cmd, port) => {
      handlers[cmd] = (r, val) => {
        if (r >= 0xa0 && r < 0xa9) { const c = r - 0xa0 + 9 * port; fn[c] = (fn[c] & 0x300) | val; upd(c); }
        else if (r >= 0xb0 && r < 0xb9) {
          const c = r - 0xb0 + 9 * port;
          fn[c] = (fn[c] & 0xff) | ((val & 3) << 8); blk[c] = (val >> 2) & 7;
          const on = (val & 0x20) !== 0, v = st[base + c];
          if (on && !v.on) v.onset = true;
          v.on = on && !(rhythm && port === 0 && c >= 6);
          upd(c);
        } else if (r >= 0xc0 && r < 0xc9) { con[r - 0xc0 + 9 * port] = val & 1; upd(r - 0xc0 + 9 * port); }
        else if (r >= 0x40 && r < 0x56) {
          const off = r - 0x40, slot = off % 8 < 6 ? Math.floor(off / 8) * 3 + (off % 8) % 3 : -1;
          if (slot < 0) return;
          const c = slot + 9 * port, car = (off % 8) >= 3 ? 1 : 0;
          tl[c][car] = val & 63; upd(c);
        } else if (r === 0xbd && port === 0) {
          rhythm = val & 0x20;
          const nb = rhythm ? val & 0x1f : 0;
          const rise = nb & ~rbits;
          if (rise & 16) hit('kick'); if (rise & 8) hit('snare'); if (rise & 4) hit('tom'); if (rise & 2) hit('crash', .7); if (rise & 1) hit('hat', .7);
          rbits = nb;
        }
      };
    });
  };

  // ---------- OPLL (YM2413) ----------
  const opll = (clock, cmd) => {
    const base = voices.length;
    for (let i = 0; i < 9; i++) add(`YM2413 ${i + 1}`, 'fm');
    const fn = new Array(9).fill(0), blk = new Array(9).fill(0), vl = new Array(9).fill(0);
    let rhythm = 0, rbits = 0;
    const upd = (c) => { const v = st[base + c]; v.freq = fn[c] * (clock / 72) / Math.pow(2, 19 - blk[c]); v.vol = db(vl[c] * 3); };
    handlers[cmd] = (r, val) => {
      if (r >= 0x10 && r < 0x19) { const c = r - 0x10; fn[c] = (fn[c] & 0x100) | val; upd(c); }
      else if (r >= 0x20 && r < 0x29) {
        const c = r - 0x20; fn[c] = (fn[c] & 0xff) | ((val & 1) << 8); blk[c] = (val >> 1) & 7;
        const on = (val & 0x10) !== 0, v = st[base + c];
        if (on && !v.on) v.onset = true;
        v.on = on && !(rhythm && c >= 6); upd(c);
      } else if (r >= 0x30 && r < 0x39) { vl[r - 0x30] = val & 15; upd(r - 0x30); }
      else if (r === 0x0e) {
        rhythm = val & 0x20;
        const nb = rhythm ? val & 0x1f : 0, rise = nb & ~rbits;
        if (rise & 16) hit('kick'); if (rise & 8) hit('snare'); if (rise & 4) hit('tom'); if (rise & 2) hit('crash', .7); if (rise & 1) hit('hat', .7);
        rbits = nb;
      }
    };
  };

  // ---------- チップの登録 ----------
  const clk = (o, v) => hdr(o, v) & 0x3fffffff;
  const dual = (o, v) => (hdr(o, v) & 0x40000000) !== 0;
  const OPN_KEYS = [0x10, 0x08, 0x02, 0x01, 0x04, 0x20]; // YM2608 リズム: BD SD TOP HH TOM RIM
  const RH = ['kick', 'snare', 'crash', 'hat', 'tom', 'perc'];

  if (clk(0x0c, 0)) { chips.push('SN76489'); sn(clk(0x0c, 0), 0, 0x50); if (dual(0x0c, 0)) sn(clk(0x0c, 0), 1, 0x30); }
  if (clk(0x10, 0x101)) { chips.push('YM2413'); opll(clk(0x10, 0x101), 0x51); }
  if (clk(0x2c, 0x110)) {
    chips.push('YM2612');
    const w = opn('YM2612', clk(0x2c, 0x110), 144, 6, [0, 1, 2, 3, 4, 5]);
    handlers[0x52] = (r, v) => w(0, r, v); handlers[0x53] = (r, v) => w(1, r, v);
  }
  if (clk(0x30, 0x110)) { chips.push('YM2151'); opm(clk(0x30, 0x110), 0, 0x54); if (dual(0x30, 0x110)) opm(clk(0x30, 0x110), 1, 0xa4); }
  const ym2203 = (idx, cmd) => {
    const c = clk(0x44, 0x151), name = 'YM2203' + (idx ? '#2' : '');
    const w = opn(name, c, 72, 3, [0, 1, 2]);
    const s = ssg(name + ' SSG', c / 4);
    handlers[cmd] = (r, v) => { if (r < 0x10) s(r, v); else w(0, r, v); };
  };
  if (clk(0x44, 0x151)) { chips.push('YM2203'); ym2203(0, 0x55); if (dual(0x44, 0x151)) ym2203(1, 0xa5); }
  if (clk(0x48, 0x151)) {
    chips.push('YM2608');
    const c = clk(0x48, 0x151);
    const w = opn('YM2608', c, 144, 6, [0, 1, 2, 3, 4, 5]), s = ssg('YM2608 SSG', c / 4);
    handlers[0x56] = (r, v) => {
      if (r < 0x10) s(r, v);
      else if (r === 0x10 && !(v & 0x80)) OPN_KEYS.forEach((b, i) => { if (v & (1 << i)) hit(RH[i]); });
      else w(0, r, v);
    };
    handlers[0x57] = (r, v) => w(1, r, v);
  }
  if (clk(0x4c, 0x151)) {
    chips.push('YM2610');
    const c = clk(0x4c, 0x151);
    const w = opn('YM2610', c, 144, 4, [1, 2, 4, 5]), s = ssg('YM2610 SSG', c / 4);
    handlers[0x58] = (r, v) => { if (r < 0x10) s(r, v); else w(0, r, v); };
    const ACH = ['kick', 'snare', 'hat', 'tom', 'crash', 'perc'];
    handlers[0x59] = (r, v) => {
      if (r === 0x00 && !(v & 0x80)) { for (let i = 0; i < 6; i++) if (v & (1 << i)) hit(ACH[i]); }
      else w(1, r, v);
    };
  }
  const oplChip = (o, v, name, cmd, cmd2) => {
    if (!clk(o, v)) return;
    chips.push(name);
    opl(name, clk(o, v) / 72, 1, [cmd]);
    if (dual(o, v)) opl(name + '#2', clk(o, v) / 72, 1, [cmd2]);
  };
  oplChip(0x50, 0x151, 'YM3812', 0x5a, 0xaa);
  oplChip(0x54, 0x151, 'YM3526', 0x5b, 0xab);
  oplChip(0x58, 0x151, 'Y8950', 0x5c, 0xac);
  if (clk(0x5c, 0x151)) { chips.push('YMF262'); opl('YMF262', clk(0x5c, 0x151) / 288, 2, [0x5e, 0x5f]); }
  if (clk(0x74, 0x151)) {
    chips.push('AY8910');
    const c = clk(0x74, 0x151);
    const a = ssg('AY8910', c), b = dual(0x74, 0x151) ? ssg('AY8910#2', c) : null;
    handlers[0xa0] = (r, v) => { if (r & 0x80) { if (b) b(r & 0x7f, v); } else a(r, v); };
  }
  if (clk(0x98, 0x161)) {
    chips.push('OKIM6295');
    const OK = ['kick', 'snare', 'hat', 'crash', 'tom', 'perc'];
    let pend = -1;
    const okiCmd = (r, v) => {
      if (r !== 0) return;
      if (pend >= 0) { if (v & 0xf0) hit(OK[pend % OK.length], .9); pend = -1; }
      else if (v & 0x80) pend = v & 0x7f;
    };
    handlers[0xb8] = okiCmd;
  }
  // 読み取れない (PCM だけで音程を持つ) チップ
  const PCM = { 0x38: 'SegaPCM', 0x88: 'MultiPCM', 0xa0: 'K054539', 0xa8: 'C140', 0xac: 'K053260', 0xb4: 'QSound', 0xd8: 'X1-010', 0xdc: 'C352', 0xe0: 'GA20', 0x68: 'YMZ280B', 0x60: 'YMF278B', 0x64: 'YMF271', 0x9c: 'K051649', 0xa4: 'HuC6280', 0x84: 'NES APU' };
  for (const [o, n] of Object.entries(PCM)) { const off = +o; if (clk(off, off >= 0xc0 ? 0x171 : off >= 0x80 ? 0x161 : 0x151)) unsupported.push(n); }

  // ---------- コマンドを読み進めて 60Hz ごとに記録 ----------
  st = voices.map(mk);
  const nv = voices.length;
  const total = d.getUint32(0x18, true);
  const maxFrames = Math.min(Math.ceil(total / FRAME) + 2, 60 * 60 * 10);
  const data = new Float32Array(maxFrames * nv * 3);
  let t = 0, nextFrame = FRAME, p = dataStart;
  const snap = () => {
    if (frame >= maxFrames) return;
    const o = frame * nv * 3;
    for (let i = 0; i < nv; i++) {
      const v = st[i];
      data[o + i * 3] = v.freq;
      data[o + i * 3 + 1] = v.on ? v.vol : 0;
      data[o + i * 3 + 2] = (v.on ? 1 : 0) | (v.onset ? 2 : 0) | (v.noise ? 4 : 0);
      v.onset = false;
    }
    frame++;
  };
  const wait = (n) => { t += n; while (t >= nextFrame) { snap(); nextFrame += FRAME; } };
  while (p < u.length && frame < maxFrames) {
    const c = u[p];
    if (c === 0x66) break;
    if (c === 0x61) { wait(d.getUint16(p + 1, true)); p += 3; continue; }
    if (c === 0x62) { wait(735); p++; continue; }
    if (c === 0x63) { wait(882); p++; continue; }
    if ((c & 0xf0) === 0x70) { wait((c & 15) + 1); p++; continue; }
    if ((c & 0xf0) === 0x80) { wait(c & 15); p++; continue; }
    if (c === 0x67) { p += 7 + d.getUint32(p + 3, true); continue; }
    if (c === 0x68) { p += 12; continue; }
    if (c >= 0x90 && c <= 0x95) { p += [5, 5, 6, 11, 2, 5][c - 0x90]; continue; }
    const h = handlers[c];
    if (c === 0x50 || c === 0x30) { if (h) h(u[p + 1]); p += 2; continue; }
    if (c === 0x4f) { p += 2; continue; }
    if (c >= 0x30 && c <= 0x3f) { p += 2; continue; }
    if (c >= 0x40 && c <= 0x4e) { p += 3; continue; }
    if (c >= 0x51 && c <= 0x5f) { if (h) h(u[p + 1], u[p + 2]); p += 3; continue; }
    if (c >= 0xa0 && c <= 0xbf) { if (h) h(u[p + 1], u[p + 2]); p += 3; continue; }
    if (c >= 0xc0 && c <= 0xdf) { p += 4; continue; }
    if (c >= 0xe0) { p += 5; continue; }
    p++; // 不明なコマンド
  }
  snap();
  const count = frame;

  return {
    voices, count, data: data.subarray(0, count * nv * 3), hits: Int32Array.from(hits),
    chips, unsupported, duration: count / 60,
  };
}
