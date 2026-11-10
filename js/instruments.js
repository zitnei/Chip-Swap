// ゲームの VGM から「そのゲームで使われている音色」を取り出す。
//  FM 音源 (YM2151 / OPN 系 / OPL 系): 発音した瞬間のオペレーター設定 (アルゴリズム・各オペレーターのレート・TL など)
//  波形メモリ (SCC / PCエンジン / ゲームボーイ): 発音した瞬間の波形
//  ファミコン / ゲームボーイのパルス: デューティ (音の太さ)
// 取り出した音色は、曲の役割 (ベース・メロディーなど) に振り分けて Chip Swap の音色として使う。
import { TONES } from './chips.js';

const FAMILIES = ['bass', 'lead', 'piano', 'strings', 'brass', 'guitar', 'bell', 'organ', 'reed', 'flute', 'pad'];
const OPL_OP = [0, 1, 2, 8, 9, 10, 16, 17, 18];
const OPL_MUL = [.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];
const DT_CENTS = [0, 3, 5, 8, 0, -3, -5, -8];
const OPM_NOTE = [0, 1, 2, 2, 3, 4, 5, 5, 6, 7, 8, 8, 9, 10, 11, 11];
const CARRIERS = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
const midiOf = (f) => (f > 0 ? 69 + 12 * Math.log2(f / 440) : 60);

// ---- レジスタ値 (5bit レート) → 秒 ----
const t96 = (R) => 1024 * Math.pow(2, 11 - R / 2) / 18000 / 1.25;
const decaySec = (R) => (R <= 0 ? 1e4 : t96(R) * 60 / 96);
const attackSec = (R) => (R >= 31 ? 0 : R <= 0 ? 1e4 : t96(R) / 9);
const slLin = (D1L) => (D1L >= 15 ? .0001 : Math.pow(10, -D1L * 3 / 20));

// OPM / OPN の 1 オペレーター → [mul, TL(dB), attack, decay, sustain, sustainDecay, release, detune]
function opnOp(dtmul, tl, ksar, d1r, d2r, slrr) {
  const mul = dtmul & 15, dt = (dtmul >> 4) & 7;
  return [mul ? mul : .5, (tl & 127) * .75, attackSec(ksar & 31), (d1r & 31) ? decaySec(d1r & 31) : 1e4,
    slLin(slrr >> 4), (d2r & 31) ? decaySec(d2r & 31) : 0, decaySec((slrr & 15) * 2 + 1), DT_CENTS[dt]];
}

// 取り出した FM パッチを整える: キャリアの音量はゲーム中で変わるので、一番大きいキャリアを 0dB に
function normalizeFM(p) {
  const car = CARRIERS[p.alg];
  const minTL = Math.min(...car.map((k) => p.ops[k][1]));
  for (const k of car) p.ops[k][1] = Math.max(0, p.ops[k][1] - minTL);
  return p;
}

export function analyzeVGMs(buffers) {
  const insts = new Map(); // key → { type, data, count, noteSum }
  const chipCount = {};
  const add = (chip, type, data, note) => {
    chipCount[chip] = (chipCount[chip] || 0) + 1;
    const key = type + ':' + JSON.stringify(data, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
    let e = insts.get(key);
    if (!e) insts.set(key, (e = { type, chip, data, count: 0, noteSum: 0 }));
    e.count++; e.noteSum += note;
  };

  for (const buf of buffers) {
    const d = new DataView(buf), u = new Uint8Array(buf);
    if (u.length < 0x40 || d.getUint32(0, true) !== 0x206d6756) continue;
    const ver = d.getUint32(8, true);
    const start = ver >= 0x150 && d.getUint32(0x34, true) ? 0x34 + d.getUint32(0x34, true) : 0x40;
    const hdr = (o, v) => (ver >= v && o + 4 <= start ? d.getUint32(o, true) & 0x3fffffff : 0);
    const clk = { opm: hdr(0x30, 0x110), opn2: hdr(0x2c, 0x110), opn: hdr(0x44, 0x151), opna: hdr(0x48, 0x151), opnb: hdr(0x4c, 0x151),
      opl2: hdr(0x50, 0x151) || hdr(0x54, 0x151) || hdr(0x58, 0x151), opl3: hdr(0x5c, 0x151), scc: hdr(0x9c, 0x161), huc: hdr(0xa4, 0x161), nes: hdr(0x84, 0x161), gb: hdr(0x80, 0x161), ay: hdr(0x74, 0x151), sn: hdr(0x0c, 0) };

    // ---- 各チップのレジスタの写し ----
    const opm = new Uint8Array(256);
    const opn = [new Uint8Array(256), new Uint8Array(256)];
    const opnFreq = new Array(6).fill(0);
    let opnName = clk.opn2 ? 'YM2612' : clk.opnb ? 'YM2610' : clk.opna ? 'YM2608' : 'YM2203';
    const opnClock = clk.opn2 || clk.opnb || clk.opna || clk.opn, opnPresc = clk.opn ? 72 : 144;
    const opl = [new Uint8Array(256), new Uint8Array(256)];
    const scc = { wave: Array.from({ length: 5 }, () => new Int8Array(32)), freq: new Array(5).fill(0), keys: 0 };
    const huc = { sel: 0, wave: Array.from({ length: 6 }, () => new Uint8Array(32)), idx: new Array(6).fill(0), ctl: new Array(6).fill(0), freq: new Array(6).fill(0) };
    const nes = new Uint8Array(0x20);
    const gb = new Uint8Array(0x40);

    const opmKey = (v) => {
      const ch = v & 7;
      if (!(v & 0x78)) return;
      const R = opm, o = [0, 16, 8, 24];
      const p = { alg: R[0x20 + ch] & 7, fb: (R[0x20 + ch] >> 3) & 7,
        ops: o.map((s) => opnOp(R[0x40 + s + ch], R[0x60 + s + ch], R[0x80 + s + ch], R[0xa0 + s + ch], R[0xc0 + s + ch], R[0xe0 + s + ch])) };
      const kc = R[0x28 + ch], note = 12 * ((kc >> 4) & 7) + OPM_NOTE[kc & 15] + 13;
      add('YM2151', 'fm', normalizeFM(p), note);
    };
    const opnKey = (v) => {
      if (!(v & 0xf0)) return;
      const c = v & 7, hw = c >= 4 ? c - 1 : c, port = hw < 3 ? 0 : 1, off = hw % 3, R = opn[port], o = [0, 8, 4, 12];
      const p = { alg: R[0xb0 + off] & 7, fb: (R[0xb0 + off] >> 3) & 7,
        ops: o.map((s) => opnOp(R[0x30 + s + off], R[0x40 + s + off], R[0x50 + s + off], R[0x60 + s + off], R[0x70 + s + off], R[0x80 + s + off])) };
      add(opnName, 'fm', normalizeFM(p), midiOf(opnFreq[hw]));
    };
    const opnWrite = (port, r, v) => {
      opn[port][r] = v;
      if (port === 0 && r === 0x28) opnKey(v);
      if (r >= 0xa0 && r < 0xa3) {
        const hw = (r & 3) + port * 3, hi = opn[port][0xa4 + (r & 3)];
        opnFreq[hw] = (((hi & 7) << 8) | v) * opnClock * Math.pow(2, ((hi >> 3) & 7) - 1) / (opnPresc * 1048576);
      }
    };
    const oplWrite = (port, r, v) => {
      const R = opl[port], was = R[r];
      R[r] = v;
      if (r >= 0xb0 && r <= 0xb8 && (v & 0x20) && !(was & 0x20)) {
        const c = r - 0xb0;
        if (port === 0 && (opl[0][0xbd] & 0x20) && c >= 6) return; // リズム音源のチャンネル
        const m = OPL_OP[c], k = m + 3;
        const op = (s) => {
          const ar = (R[0x60 + s] >> 4) * 2, dr = (R[0x60 + s] & 15) * 2, sl = R[0x80 + s] >> 4, rr = (R[0x80 + s] & 15) * 2, sus = R[0x20 + s] & 0x20;
          return [OPL_MUL[R[0x20 + s] & 15], (R[0x40 + s] & 63) * .75, attackSec(ar ? ar + 1 : 0), dr ? decaySec(dr) : 1e4, slLin(sl), sus ? 0 : decaySec(rr || 1), decaySec(rr || 1), 0];
        };
        const cnt = R[0xc0 + c] & 1, fb = (R[0xc0 + c] >> 1) & 7;
        const silent = [1, 120, 0, 1e4, 1, 0, .1, 0];
        // 2 オペレーター → Chip Swap の 4 オペ FM (残り 2 つは無音)
        const p = cnt ? { alg: 7, fb, ops: [op(m), op(k), silent, silent] } : { alg: 4, fb, ops: [op(m), op(k), silent, silent] };
        if (!cnt) { p.ops[1][1] = 0; } else { const mn = Math.min(p.ops[0][1], p.ops[1][1]); p.ops[0][1] -= mn; p.ops[1][1] -= mn; }
        const fnum = ((v & 3) << 8) | R[0xa0 + c], blk = (v >> 2) & 7;
        add(clk.opl3 ? 'YMF262' : 'YM3812', 'fm', p, midiOf(fnum * 49716 / Math.pow(2, 20 - blk)));
      }
    };

    const wave8 = (a) => Array.from(a, (x) => Math.round((x / 128) * 1000) / 1000);
    const handlers = {
      0x54: (r, v) => { opm[r] = v; if (r === 0x08) opmKey(v); },
      0x52: (r, v) => opnWrite(0, r, v), 0x53: (r, v) => opnWrite(1, r, v),
      0x55: (r, v) => { if (r >= 0x10) opnWrite(0, r, v); },
      0x56: (r, v) => { if (r >= 0x10) opnWrite(0, r, v); }, 0x57: (r, v) => opnWrite(1, r, v),
      0x58: (r, v) => { if (r >= 0x10) opnWrite(0, r, v); }, 0x59: (r, v) => { if (r >= 0x30) opnWrite(1, r, v); },
      0x5a: (r, v) => oplWrite(0, r, v), 0x5b: (r, v) => oplWrite(0, r, v), 0x5c: (r, v) => oplWrite(0, r, v),
      0x5e: (r, v) => oplWrite(0, r, v), 0x5f: (r, v) => oplWrite(1, r, v),
      0xb4: (a, v) => {
        if (a & 0x80 || a >= 0x20) return;
        nes[a] = v;
        if (a === 0x03 || a === 0x07) {
          const b = a - 3, t = nes[b + 2] | ((v & 7) << 8);
          add('NES APU', 'pulse', { duty: [.125, .25, .5, .75][nes[b] >> 6] }, midiOf(1789773 / (16 * (t + 1))));
        }
      },
      0xb3: (a, v) => {
        if (a & 0x80 || a >= 0x40) return;
        gb[a] = v;
        if ((a === 0x04 || a === 0x09) && v & 0x80) {
          const b = a === 0x04 ? 0 : 5, x = gb[b + 3] | ((v & 7) << 8);
          add('GameBoy', 'pulse', { duty: [.125, .25, .5, .75][gb[b + 1] >> 6] }, midiOf(131072 / (2048 - x)));
        }
        if (a === 0x0e && v & 0x80) {
          const t = [];
          for (let i = 0; i < 16; i++) { t.push((gb[0x20 + i] >> 4) / 7.5 - 1, (gb[0x20 + i] & 15) / 7.5 - 1); }
          add('GameBoy', 'wave', { table: t.map((x) => Math.round(x * 1000) / 1000) }, midiOf(65536 / (2048 - (gb[0x0d] | ((v & 7) << 8)))));
        }
      },
      0xb9: (a, v) => {
        if (a & 0x80) return;
        const H = huc;
        if (a === 0) { H.sel = v & 7; return; }
        const c = H.sel; if (c > 5) return;
        if (a === 2) H.freq[c] = (H.freq[c] & 0xf00) | v;
        else if (a === 3) H.freq[c] = (H.freq[c] & 0xff) | ((v & 15) << 8);
        else if (a === 4) {
          if ((H.ctl[c] & 0x40) && !(v & 0x40)) H.idx[c] = 0;
          if ((v & 0x80) && !(H.ctl[c] & 0x80) && !(v & 0x40)) add('HuC6280', 'wave', { table: Array.from(H.wave[c], (x) => Math.round((x / 15.5 - 1) * 1000) / 1000) }, midiOf((clk.huc || 3579545) / (32 * Math.max(1, H.freq[c]))));
          H.ctl[c] = v;
        } else if (a === 6 && !(H.ctl[c] & 0x40)) { H.wave[c][H.idx[c] & 31] = v & 31; H.idx[c]++; }
      },
    };
    const sccPort = (port, a, v) => {
      port &= 0x7f;
      if (port === 0 && a < 0x80) scc.wave[a >> 5][a & 31] = (v << 24) >> 24;
      else if (port === 1) { const c = a >> 1; if (c < 5) scc.freq[c] = a & 1 ? (scc.freq[c] & 0xff) | ((v & 15) << 8) : (scc.freq[c] & 0xf00) | v; }
      else if (port === 3) {
        const rise = v & ~scc.keys; scc.keys = v;
        for (let c = 0; c < 5; c++) if (rise & (1 << c)) add('K051649 (SCC)', 'wave', { table: wave8(scc.wave[Math.min(c, 3)]) }, midiOf((clk.scc || 1789772) / (16 * (scc.freq[c] + 1))));
      }
    };

    // ---- コマンドを読む (音色だけが目的なので待ち時間は数えない) ----
    let p = start;
    while (p < u.length) {
      const c = u[p];
      if (c === 0x66) break;
      if (c === 0x61) { p += 3; continue; }
      if (c === 0x62 || c === 0x63 || (c & 0xf0) === 0x70 || (c & 0xf0) === 0x80) { p++; continue; }
      if (c === 0x67) { p += 7 + d.getUint32(p + 3, true); continue; }
      if (c === 0x68) { p += 12; continue; }
      if (c >= 0x90 && c <= 0x95) { p += [5, 5, 6, 11, 2, 5][c - 0x90]; continue; }
      if (c === 0x4f || c === 0x50 || (c >= 0x30 && c <= 0x3f)) { p += 2; continue; }
      if (c >= 0x40 && c <= 0x4e) { p += 3; continue; }
      if ((c >= 0x51 && c <= 0x5f) || (c >= 0xa0 && c <= 0xbf)) { const h = handlers[c]; if (h) h(u[p + 1], u[p + 2]); p += 3; continue; }
      if (c === 0xd2) { sccPort(u[p + 1], u[p + 2], u[p + 3]); p += 4; continue; }
      if (c >= 0xc0 && c <= 0xdf) { p += 4; continue; }
      if (c >= 0xe0) { p += 5; continue; }
      p++;
    }
    if (clk.ay) chipCount['AY8910'] = (chipCount['AY8910'] || 0) + 1;
    if (clk.sn) chipCount['SN76489'] = (chipCount['SN76489'] || 0) + 1;
  }

  // ---- 一番使われているチップに合わせて、Chip Swap の音源を決める ----
  const main = Object.entries(chipCount).sort((a, b) => b[1] - a[1])[0];
  if (!main) return null;
  const BASE = { YM2151: 'cps1', YM2612: 'ym2612', YM2610: 'ym2610', YM2608: 'ym2610', YM2203: 'ym2610', YM3812: 'ym2610', YMF262: 'ym2610',
    'K051649 (SCC)': 'scc', HuC6280: 'huc6280', 'NES APU': '2a03', GameBoy: '2a03', AY8910: 'ay8910', SN76489: 'sn76489' };
  const chipName = main[0];
  const base = BASE[chipName];
  const list = [...insts.values()].filter((e) => e.chip === chipName || (chipName === 'GameBoy' && e.chip === 'GameBoy'))
    .map((e) => ({ ...e, avgNote: e.noteSum / e.count })).sort((a, b) => b.count - a.count).slice(0, 16);
  return { chip: chipName, base, instruments: list };
}

// 取り出した音色を Chip Swap の音色 (TONES と同じ形) にして、役割 (ベース・メロディー…) に振り分ける
export function buildToneSet(analysis, gameId, gameTitle) {
  const ins = analysis.instruments;
  const tones = {}, map = {}, list = [];
  if (!ins.length) return { tones, map, list };
  const total = ins.reduce((n, e) => n + e.count, 0);
  const main = ins.filter((e) => e.count >= total * .03);
  const pool = main.length ? main : ins;
  const byNote = [...pool].sort((a, b) => a.avgNote - b.avgNote);
  const roleOf = new Map();
  roleOf.set(byNote[0], 'bass');
  if (byNote.length > 1) roleOf.set(byNote[byNote.length - 1], 'lead');
  ins.forEach((e, i) => {
    const key = `g${gameId}:${i}`;
    const role = roleOf.get(e) || '';
    const fam = role || FAMILIES[2 + (i % (FAMILIES.length - 2))];
    const baseTone = TONES[fam] || TONES.lead;
    const t = { label: `${gameTitle} 音色${i + 1}${role === 'bass' ? ' (ベース)' : role === 'lead' ? ' (メロディー)' : ''}`,
      harm: baseTone.harm, duty: baseTone.duty, env: baseTone.env, vib: baseTone.vib, fm: baseTone.fm, game: true };
    if (e.type === 'fm') t.fm = { alg: e.data.alg, fb: e.data.fb, ops: e.data.ops.map((o) => o.slice()) };
    if (e.type === 'wave') t.table = Float32Array.from(e.data.table);
    if (e.type === 'pulse') t.duty = e.data.duty;
    tones[key] = t;
    list.push({ key, label: t.label, count: e.count, avgNote: Math.round(e.avgNote), type: e.type });
  });
  // ファミリー → 音色: ベースとメロディーは決めた音色、その他は使われている順に割り当て
  const keys = list.map((x) => x.key);
  const bassKey = keys[ins.indexOf(byNote[0])];
  const leadKey = byNote.length > 1 ? keys[ins.indexOf(byNote[byNote.length - 1])] : bassKey;
  const others = keys.filter((k) => k !== bassKey && k !== leadKey);
  const rest = others.length ? others : [leadKey];
  map.bass = bassKey; map.lead = leadKey;
  FAMILIES.slice(2).forEach((f, i) => { map[f] = ['brass', 'reed', 'flute'].includes(f) ? (i % 2 ? leadKey : rest[i % rest.length]) : rest[i % rest.length]; });
  return { tones, map, list };
}
