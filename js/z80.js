// Zilog Z80 CPU emulator — single dependency-free ES module.
//
// Usage:
//   const cpu = new Z80(mem /* Uint8Array(65536) */, { in(port) { return 0xFF; }, out(port, val) {} });
//   cpu.reset(); const t = cpu.step(); cpu.interrupt();
//
// Registers are plain numeric properties: a f b c d e h l, a_ f_ b_ c_ d_ e_ h_ l_,
// ix iy sp pc (16-bit), i r, iff1 iff2 im halted.
// Covers the full documented instruction set plus the common undocumented parts
// (SLL, IXH/IXL/IYH/IYL, DDCB/FDCB register copies, IN (C)/OUT (C),0, flag bits 3/5
// for most instructions). Verified with zexdoc.

const FC = 0x01, FN = 0x02, FPV = 0x04, F3 = 0x08, FH = 0x10, F5 = 0x20, FZ = 0x40, FS = 0x80;
const F35 = F3 | F5;

const SZ = new Uint8Array(256);   // S, Z, 5, 3
const SZP = new Uint8Array(256);  // S, Z, 5, 3, P
for (let i = 0; i < 256; i++) {
  const s = (i & (FS | F35)) | (i === 0 ? FZ : 0);
  let p = i; p ^= p >> 4; p ^= p >> 2; p ^= p >> 1;
  SZ[i] = s;
  SZP[i] = s | ((p & 1) ? 0 : FPV);
}

// Base T-states for unprefixed opcodes (conditional extras added in code).
const CYC = new Uint8Array([
  4, 10, 7, 6, 4, 4, 7, 4, 4, 11, 7, 6, 4, 4, 7, 4,
  8, 10, 7, 6, 4, 4, 7, 4, 12, 11, 7, 6, 4, 4, 7, 4,
  7, 10, 16, 6, 4, 4, 7, 4, 7, 11, 16, 6, 4, 4, 7, 4,
  7, 10, 13, 6, 11, 11, 10, 4, 7, 11, 13, 6, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  7, 7, 7, 7, 7, 7, 4, 7, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  5, 10, 10, 10, 10, 11, 7, 11, 5, 10, 10, 0, 10, 17, 7, 11,
  5, 10, 10, 11, 10, 11, 7, 11, 5, 4, 10, 11, 10, 0, 7, 11,
  5, 10, 10, 19, 10, 11, 7, 11, 5, 4, 10, 4, 10, 0, 7, 11,
  5, 10, 10, 4, 10, 11, 7, 11, 5, 6, 10, 4, 10, 0, 7, 11,
]);

export class Z80 {
  constructor(mem, io) {
    this.mem = mem;
    this.io = io || { in: () => 0xFF, out: () => {} };
    this.reset();
  }

  reset() {
    this.a = 0xFF; this.f = 0xFF;
    this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.a_ = 0; this.f_ = 0; this.b_ = 0; this.c_ = 0; this.d_ = 0; this.e_ = 0; this.h_ = 0; this.l_ = 0;
    this.ix = 0; this.iy = 0; this.sp = 0xFFFF; this.pc = 0;
    this.i = 0; this.r = 0;
    this.iff1 = 0; this.iff2 = 0; this.im = 0;
    this.halted = false;
    this.eiDelay = false;
  }

  // ---------- helpers ----------
  incR() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7F); }
  fetchOp() { this.incR(); const v = this.mem[this.pc]; this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch8() { const v = this.mem[this.pc]; this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch16() {
    const m = this.mem, pc = this.pc;
    const v = m[pc] | (m[(pc + 1) & 0xFFFF] << 8);
    this.pc = (pc + 2) & 0xFFFF; return v;
  }
  read16(addr) { return this.mem[addr] | (this.mem[(addr + 1) & 0xFFFF] << 8); }
  write16(addr, v) { this.mem[addr] = v & 0xFF; this.mem[(addr + 1) & 0xFFFF] = (v >> 8) & 0xFF; }
  push(v) {
    this.sp = (this.sp - 1) & 0xFFFF; this.mem[this.sp] = (v >> 8) & 0xFF;
    this.sp = (this.sp - 1) & 0xFFFF; this.mem[this.sp] = v & 0xFF;
  }
  pop() {
    const m = this.mem;
    const v = m[this.sp] | (m[(this.sp + 1) & 0xFFFF] << 8);
    this.sp = (this.sp + 2) & 0xFFFF; return v;
  }

  getBC() { return (this.b << 8) | this.c; }
  getDE() { return (this.d << 8) | this.e; }
  getHL() { return (this.h << 8) | this.l; }
  setBC(v) { this.b = (v >> 8) & 0xFF; this.c = v & 0xFF; }
  setDE(v) { this.d = (v >> 8) & 0xFF; this.e = v & 0xFF; }
  setHL(v) { this.h = (v >> 8) & 0xFF; this.l = v & 0xFF; }

  getXY(xy) { return xy === 0 ? (this.h << 8) | this.l : xy === 1 ? this.ix : this.iy; }
  setXY(xy, v) {
    v &= 0xFFFF;
    if (xy === 0) { this.h = v >> 8; this.l = v & 0xFF; } else if (xy === 1) this.ix = v; else this.iy = v;
  }
  // Effective address for (HL) / (IX+d) / (IY+d); reads displacement for indexed.
  addrXY(xy) {
    if (xy === 0) return (this.h << 8) | this.l;
    const d = this.fetch8();
    return ((xy === 1 ? this.ix : this.iy) + (d < 128 ? d : d - 256)) & 0xFFFF;
  }

  // 8-bit register by index (0..7 = B C D E H L - A), with H/L -> IXH/IXL/IYH/IYL substitution.
  getR(i, xy) {
    switch (i) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return xy === 0 ? this.h : xy === 1 ? this.ix >> 8 : this.iy >> 8;
      case 5: return xy === 0 ? this.l : xy === 1 ? this.ix & 0xFF : this.iy & 0xFF;
      case 7: return this.a;
    }
    return 0;
  }
  setR(i, xy, v) {
    switch (i) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4:
        if (xy === 0) this.h = v; else if (xy === 1) this.ix = (this.ix & 0xFF) | (v << 8); else this.iy = (this.iy & 0xFF) | (v << 8);
        break;
      case 5:
        if (xy === 0) this.l = v; else if (xy === 1) this.ix = (this.ix & 0xFF00) | v; else this.iy = (this.iy & 0xFF00) | v;
        break;
      case 7: this.a = v; break;
    }
  }

  // ---------- ALU ----------
  alu(op, v) {
    const a = this.a;
    let r;
    switch (op) {
      case 0: // ADD
        r = a + v;
        this.f = SZ[r & 0xFF] | (r >> 8) | ((a ^ v ^ r) & FH) | ((~(a ^ v) & (a ^ r) & 0x80) ? FPV : 0);
        this.a = r & 0xFF; return;
      case 1: // ADC
        r = a + v + (this.f & FC);
        this.f = SZ[r & 0xFF] | (r >> 8) | ((a ^ v ^ r) & FH) | ((~(a ^ v) & (a ^ r) & 0x80) ? FPV : 0);
        this.a = r & 0xFF; return;
      case 2: // SUB
        r = a - v;
        this.f = SZ[r & 0xFF] | FN | ((r >> 8) & FC) | ((a ^ v ^ r) & FH) | (((a ^ v) & (a ^ r) & 0x80) ? FPV : 0);
        this.a = r & 0xFF; return;
      case 3: // SBC
        r = a - v - (this.f & FC);
        this.f = SZ[r & 0xFF] | FN | ((r >> 8) & FC) | ((a ^ v ^ r) & FH) | (((a ^ v) & (a ^ r) & 0x80) ? FPV : 0);
        this.a = r & 0xFF; return;
      case 4: // AND
        this.a = a & v; this.f = SZP[this.a] | FH; return;
      case 5: // XOR
        this.a = a ^ v; this.f = SZP[this.a]; return;
      case 6: // OR
        this.a = a | v; this.f = SZP[this.a]; return;
      case 7: // CP
        r = a - v;
        this.f = (SZ[r & 0xFF] & ~F35) | (v & F35) | FN | ((r >> 8) & FC) | ((a ^ v ^ r) & FH) |
          (((a ^ v) & (a ^ r) & 0x80) ? FPV : 0);
        return;
    }
  }
  inc8(v) {
    const r = (v + 1) & 0xFF;
    this.f = (this.f & FC) | SZ[r] | ((r & 0x0F) === 0 ? FH : 0) | (r === 0x80 ? FPV : 0);
    return r;
  }
  dec8(v) {
    const r = (v - 1) & 0xFF;
    this.f = (this.f & FC) | FN | SZ[r] | ((v & 0x0F) === 0 ? FH : 0) | (r === 0x7F ? FPV : 0);
    return r;
  }
  add16(x, y) {
    const r = x + y;
    this.f = (this.f & (FS | FZ | FPV)) | ((r >> 16) & FC) | (((x ^ y ^ r) >> 8) & FH) | ((r >> 8) & F35);
    return r & 0xFFFF;
  }
  adc16(x, y) {
    const r = x + y + (this.f & FC);
    const r16 = r & 0xFFFF;
    this.f = ((r >> 16) & FC) | (((x ^ y ^ r) >> 8) & FH) | ((r16 >> 8) & (FS | F35)) |
      (r16 === 0 ? FZ : 0) | ((~(x ^ y) & (x ^ r) & 0x8000) ? FPV : 0);
    return r16;
  }
  sbc16(x, y) {
    const r = x - y - (this.f & FC);
    const r16 = r & 0xFFFF;
    this.f = FN | ((r >> 16) & FC) | (((x ^ y ^ r) >> 8) & FH) | ((r16 >> 8) & (FS | F35)) |
      (r16 === 0 ? FZ : 0) | (((x ^ y) & (x ^ r) & 0x8000) ? FPV : 0);
    return r16;
  }
  // CB rotate/shift group (op 0..7): RLC RRC RL RR SLA SRA SLL SRL
  rot(op, v) {
    let r, c;
    switch (op) {
      case 0: c = v >> 7; r = ((v << 1) | c) & 0xFF; break;
      case 1: c = v & 1; r = (v >> 1) | (c << 7); break;
      case 2: c = v >> 7; r = ((v << 1) | (this.f & FC)) & 0xFF; break;
      case 3: c = v & 1; r = (v >> 1) | ((this.f & FC) << 7); break;
      case 4: c = v >> 7; r = (v << 1) & 0xFF; break;
      case 5: c = v & 1; r = (v >> 1) | (v & 0x80); break;
      case 6: c = v >> 7; r = ((v << 1) | 1) & 0xFF; break;
      default: c = v & 1; r = v >> 1; break;
    }
    this.f = SZP[r] | c;
    return r;
  }
  bit(b, v, x35) {
    const m = v & (1 << b);
    this.f = (this.f & FC) | FH | (x35 & F35) | (m ? (m & FS) : (FZ | FPV));
  }
  daa() {
    const a = this.a, f = this.f;
    let diff = 0, c = f & FC;
    const lo = a & 0x0F;
    if ((f & FH) || lo > 9) diff = 0x06;
    if (c || a > 0x99) { diff |= 0x60; c = FC; }
    let r, h;
    if (f & FN) { r = (a - diff) & 0xFF; h = (f & FH) && lo < 6 ? FH : 0; }
    else { r = (a + diff) & 0xFF; h = lo > 9 ? FH : 0; }
    this.a = r;
    this.f = SZP[r] | c | (f & FN) | h;
  }
  cond(cc) {
    const f = this.f;
    switch (cc) {
      case 0: return !(f & FZ); case 1: return !!(f & FZ);
      case 2: return !(f & FC); case 3: return !!(f & FC);
      case 4: return !(f & FPV); case 5: return !!(f & FPV);
      case 6: return !(f & FS); default: return !!(f & FS);
    }
  }

  // ---------- public API ----------
  step() {
    if (this.halted) { this.incR(); return 4; }
    this.eiDelay = false;
    return this.exec(this.fetchOp(), 0);
  }

  interrupt() {
    if (!this.iff1 || this.eiDelay) return 0;
    this.halted = false;
    this.iff1 = 0; this.iff2 = 0;
    this.incR();
    this.push(this.pc);
    if (this.im === 2) {
      this.pc = this.read16(((this.i << 8) | 0xFF) & 0xFFFF);
      return 19;
    }
    this.pc = 0x0038;
    return 13;
  }

  nmi() {
    this.halted = false;
    this.iff2 = this.iff1; this.iff1 = 0;
    this.incR();
    this.push(this.pc);
    this.pc = 0x0066;
    return 11;
  }

  // ---------- main decoder (xy: 0 = HL, 1 = IX, 2 = IY) ----------
  exec(op, xy) {
    const m = this.mem;
    let t = CYC[op] + (xy ? 4 : 0);

    // LD r,r' block
    if (op >= 0x40 && op < 0x80) {
      if (op === 0x76) { this.halted = true; return t; }
      const dst = (op >> 3) & 7, src = op & 7;
      if (src === 6) { const ad = this.addrXY(xy); this.setR(dst, 0, m[ad]); if (xy) t += 8; }
      else if (dst === 6) { const ad = this.addrXY(xy); m[ad] = this.getR(src, 0); if (xy) t += 8; }
      else this.setR(dst, xy, this.getR(src, xy));
      return t;
    }
    // ALU A,r block
    if (op >= 0x80 && op < 0xC0) {
      const src = op & 7;
      let v;
      if (src === 6) { v = m[this.addrXY(xy)]; if (xy) t += 8; }
      else v = this.getR(src, xy);
      this.alu((op >> 3) & 7, v);
      return t;
    }

    switch (op) {
      case 0x00: return t; // NOP
      case 0x01: this.setBC(this.fetch16()); return t;
      case 0x11: this.setDE(this.fetch16()); return t;
      case 0x21: this.setXY(xy, this.fetch16()); return t;
      case 0x31: this.sp = this.fetch16(); return t;
      case 0x02: m[this.getBC()] = this.a; return t;
      case 0x12: m[this.getDE()] = this.a; return t;
      case 0x0A: this.a = m[this.getBC()]; return t;
      case 0x1A: this.a = m[this.getDE()]; return t;
      case 0x22: this.write16(this.fetch16(), this.getXY(xy)); return t;
      case 0x2A: this.setXY(xy, this.read16(this.fetch16())); return t;
      case 0x32: m[this.fetch16()] = this.a; return t;
      case 0x3A: this.a = m[this.fetch16()]; return t;
      case 0x03: this.setBC((this.getBC() + 1) & 0xFFFF); return t;
      case 0x13: this.setDE((this.getDE() + 1) & 0xFFFF); return t;
      case 0x23: this.setXY(xy, this.getXY(xy) + 1); return t;
      case 0x33: this.sp = (this.sp + 1) & 0xFFFF; return t;
      case 0x0B: this.setBC((this.getBC() - 1) & 0xFFFF); return t;
      case 0x1B: this.setDE((this.getDE() - 1) & 0xFFFF); return t;
      case 0x2B: this.setXY(xy, this.getXY(xy) - 1); return t;
      case 0x3B: this.sp = (this.sp - 1) & 0xFFFF; return t;
      case 0x09: this.setXY(xy, this.add16(this.getXY(xy), this.getBC())); return t;
      case 0x19: this.setXY(xy, this.add16(this.getXY(xy), this.getDE())); return t;
      case 0x29: { const v = this.getXY(xy); this.setXY(xy, this.add16(v, v)); return t; }
      case 0x39: this.setXY(xy, this.add16(this.getXY(xy), this.sp)); return t;

      // INC r / DEC r / LD r,n
      case 0x04: case 0x0C: case 0x14: case 0x1C: case 0x24: case 0x2C: case 0x3C: {
        const r = (op >> 3) & 7; this.setR(r, xy, this.inc8(this.getR(r, xy))); return t;
      }
      case 0x05: case 0x0D: case 0x15: case 0x1D: case 0x25: case 0x2D: case 0x3D: {
        const r = (op >> 3) & 7; this.setR(r, xy, this.dec8(this.getR(r, xy))); return t;
      }
      case 0x34: { const ad = this.addrXY(xy); m[ad] = this.inc8(m[ad]); return xy ? t + 8 : t; }
      case 0x35: { const ad = this.addrXY(xy); m[ad] = this.dec8(m[ad]); return xy ? t + 8 : t; }
      case 0x06: case 0x0E: case 0x16: case 0x1E: case 0x26: case 0x2E: case 0x3E:
        this.setR((op >> 3) & 7, xy, this.fetch8()); return t;
      case 0x36: { const ad = this.addrXY(xy); m[ad] = this.fetch8(); return xy ? t + 5 : t; }

      // Accumulator rotates and misc
      case 0x07: { const a = this.a, c = a >> 7; this.a = ((a << 1) | c) & 0xFF; this.f = (this.f & (FS | FZ | FPV)) | (this.a & F35) | c; return t; }
      case 0x0F: { const a = this.a, c = a & 1; this.a = (a >> 1) | (c << 7); this.f = (this.f & (FS | FZ | FPV)) | (this.a & F35) | c; return t; }
      case 0x17: { const a = this.a, c = a >> 7; this.a = ((a << 1) | (this.f & FC)) & 0xFF; this.f = (this.f & (FS | FZ | FPV)) | (this.a & F35) | c; return t; }
      case 0x1F: { const a = this.a, c = a & 1; this.a = (a >> 1) | ((this.f & FC) << 7); this.f = (this.f & (FS | FZ | FPV)) | (this.a & F35) | c; return t; }
      case 0x27: this.daa(); return t;
      case 0x2F: this.a ^= 0xFF; this.f = (this.f & (FS | FZ | FPV | FC)) | FH | FN | (this.a & F35); return t;
      case 0x37: this.f = (this.f & (FS | FZ | FPV)) | FC | (this.a & F35); return t;
      case 0x3F: { const c = this.f & FC; this.f = ((this.f & (FS | FZ | FPV)) | (c ? FH : FC) | (this.a & F35)); return t; }
      case 0x08: {
        let x = this.a; this.a = this.a_; this.a_ = x;
        x = this.f; this.f = this.f_; this.f_ = x; return t;
      }

      // Relative jumps
      case 0x10: {
        const d = this.fetch8();
        this.b = (this.b - 1) & 0xFF;
        if (this.b !== 0) { this.pc = (this.pc + (d < 128 ? d : d - 256)) & 0xFFFF; t += 5; }
        return t;
      }
      case 0x18: { const d = this.fetch8(); this.pc = (this.pc + (d < 128 ? d : d - 256)) & 0xFFFF; return t; }
      case 0x20: case 0x28: case 0x30: case 0x38: {
        const d = this.fetch8();
        if (this.cond((op >> 3) & 3)) { this.pc = (this.pc + (d < 128 ? d : d - 256)) & 0xFFFF; t += 5; }
        return t;
      }

      // Returns, jumps, calls
      case 0xC0: case 0xC8: case 0xD0: case 0xD8: case 0xE0: case 0xE8: case 0xF0: case 0xF8:
        if (this.cond((op >> 3) & 7)) { this.pc = this.pop(); t += 6; }
        return t;
      case 0xC9: this.pc = this.pop(); return t;
      case 0xC2: case 0xCA: case 0xD2: case 0xDA: case 0xE2: case 0xEA: case 0xF2: case 0xFA: {
        const nn = this.fetch16(); if (this.cond((op >> 3) & 7)) this.pc = nn; return t;
      }
      case 0xC3: this.pc = this.fetch16(); return t;
      case 0xC4: case 0xCC: case 0xD4: case 0xDC: case 0xE4: case 0xEC: case 0xF4: case 0xFC: {
        const nn = this.fetch16();
        if (this.cond((op >> 3) & 7)) { this.push(this.pc); this.pc = nn; t += 7; }
        return t;
      }
      case 0xCD: { const nn = this.fetch16(); this.push(this.pc); this.pc = nn; return t; }
      case 0xC7: case 0xCF: case 0xD7: case 0xDF: case 0xE7: case 0xEF: case 0xF7: case 0xFF:
        this.push(this.pc); this.pc = op & 0x38; return t;
      case 0xE9: this.pc = this.getXY(xy); return t;

      // Stack
      case 0xC1: this.setBC(this.pop()); return t;
      case 0xD1: this.setDE(this.pop()); return t;
      case 0xE1: this.setXY(xy, this.pop()); return t;
      case 0xF1: { const v = this.pop(); this.a = v >> 8; this.f = v & 0xFF; return t; }
      case 0xC5: this.push(this.getBC()); return t;
      case 0xD5: this.push(this.getDE()); return t;
      case 0xE5: this.push(this.getXY(xy)); return t;
      case 0xF5: this.push((this.a << 8) | this.f); return t;
      case 0xE3: {
        const v = this.read16(this.sp); this.write16(this.sp, this.getXY(xy)); this.setXY(xy, v); return t;
      }
      case 0xF9: this.sp = this.getXY(xy); return t;

      // ALU A,n
      case 0xC6: case 0xCE: case 0xD6: case 0xDE: case 0xE6: case 0xEE: case 0xF6: case 0xFE:
        this.alu((op >> 3) & 7, this.fetch8()); return t;

      // Exchanges
      case 0xEB: {
        let x = this.d; this.d = this.h; this.h = x;
        x = this.e; this.e = this.l; this.l = x; return t;
      }
      case 0xD9: {
        let x;
        x = this.b; this.b = this.b_; this.b_ = x; x = this.c; this.c = this.c_; this.c_ = x;
        x = this.d; this.d = this.d_; this.d_ = x; x = this.e; this.e = this.e_; this.e_ = x;
        x = this.h; this.h = this.h_; this.h_ = x; x = this.l; this.l = this.l_; this.l_ = x;
        return t;
      }

      // I/O
      case 0xD3: { const n = this.fetch8(); this.io.out((this.a << 8) | n, this.a); return t; }
      case 0xDB: { const n = this.fetch8(); this.a = this.io.in((this.a << 8) | n) & 0xFF; return t; }

      // Interrupt control
      case 0xF3: this.iff1 = 0; this.iff2 = 0; return t;
      case 0xFB: this.iff1 = 1; this.iff2 = 1; this.eiDelay = true; return t;

      // Prefixes
      case 0xCB: return xy ? this.execIdxCB(xy) : this.execCB();
      case 0xED: return (xy ? 4 : 0) + this.execED();
      case 0xDD: return (xy ? 4 : 0) + this.exec(this.fetchOp(), 1);
      case 0xFD: return (xy ? 4 : 0) + this.exec(this.fetchOp(), 2);
    }
    return t;
  }

  execCB() {
    const op = this.fetchOp();
    const m = this.mem;
    const r = op & 7, y = (op >> 3) & 7;
    if (r === 6) {
      const ad = (this.h << 8) | this.l;
      const v = m[ad];
      if (op < 0x40) { m[ad] = this.rot(y, v); return 15; }
      if (op < 0x80) { this.bit(y, v, ad >> 8); return 12; }
      m[ad] = op < 0xC0 ? v & ~(1 << y) : v | (1 << y);
      return 15;
    }
    const v = this.getR(r, 0);
    if (op < 0x40) this.setR(r, 0, this.rot(y, v));
    else if (op < 0x80) this.bit(y, v, v);
    else this.setR(r, 0, op < 0xC0 ? v & ~(1 << y) : v | (1 << y));
    return 8;
  }

  // DDCB d op / FDCB d op  (displacement precedes opcode; opcode fetch is not an M1 cycle)
  execIdxCB(xy) {
    const m = this.mem;
    const d = this.fetch8();
    const op = this.fetch8();
    const ad = ((xy === 1 ? this.ix : this.iy) + (d < 128 ? d : d - 256)) & 0xFFFF;
    const r = op & 7, y = (op >> 3) & 7;
    const v = m[ad];
    let res;
    if (op < 0x40) res = this.rot(y, v);
    else if (op < 0x80) { this.bit(y, v, ad >> 8); return 20; }
    else res = op < 0xC0 ? v & ~(1 << y) : v | (1 << y);
    m[ad] = res;
    if (r !== 6) this.setR(r, 0, res);
    return 23;
  }

  execED() {
    const op = this.fetchOp();
    const m = this.mem;
    switch (op) {
      // IN r,(C)
      case 0x40: case 0x48: case 0x50: case 0x58: case 0x60: case 0x68: case 0x70: case 0x78: {
        const v = this.io.in(this.getBC()) & 0xFF;
        this.f = (this.f & FC) | SZP[v];
        const r = (op >> 3) & 7;
        if (r !== 6) this.setR(r, 0, v);
        return 12;
      }
      // OUT (C),r
      case 0x41: case 0x49: case 0x51: case 0x59: case 0x61: case 0x69: case 0x71: case 0x79: {
        const r = (op >> 3) & 7;
        this.io.out(this.getBC(), r === 6 ? 0 : this.getR(r, 0));
        return 12;
      }
      case 0x42: this.setHL(this.sbc16(this.getHL(), this.getBC())); return 15;
      case 0x52: this.setHL(this.sbc16(this.getHL(), this.getDE())); return 15;
      case 0x62: { const v = this.getHL(); this.setHL(this.sbc16(v, v)); return 15; }
      case 0x72: this.setHL(this.sbc16(this.getHL(), this.sp)); return 15;
      case 0x4A: this.setHL(this.adc16(this.getHL(), this.getBC())); return 15;
      case 0x5A: this.setHL(this.adc16(this.getHL(), this.getDE())); return 15;
      case 0x6A: { const v = this.getHL(); this.setHL(this.adc16(v, v)); return 15; }
      case 0x7A: this.setHL(this.adc16(this.getHL(), this.sp)); return 15;
      case 0x43: this.write16(this.fetch16(), this.getBC()); return 20;
      case 0x53: this.write16(this.fetch16(), this.getDE()); return 20;
      case 0x63: this.write16(this.fetch16(), this.getHL()); return 20;
      case 0x73: this.write16(this.fetch16(), this.sp); return 20;
      case 0x4B: this.setBC(this.read16(this.fetch16())); return 20;
      case 0x5B: this.setDE(this.read16(this.fetch16())); return 20;
      case 0x6B: this.setHL(this.read16(this.fetch16())); return 20;
      case 0x7B: this.sp = this.read16(this.fetch16()); return 20;
      case 0x44: case 0x4C: case 0x54: case 0x5C: case 0x64: case 0x6C: case 0x74: case 0x7C: {
        const v = this.a; this.a = 0; this.alu(2, v); return 8;
      }
      case 0x45: case 0x4D: case 0x55: case 0x5D: case 0x65: case 0x6D: case 0x75: case 0x7D:
        this.iff1 = this.iff2; this.pc = this.pop(); return 14;
      case 0x46: case 0x4E: case 0x66: case 0x6E: this.im = 0; return 8;
      case 0x56: case 0x76: this.im = 1; return 8;
      case 0x5E: case 0x7E: this.im = 2; return 8;
      case 0x47: this.i = this.a; return 9;
      case 0x4F: this.r = this.a; return 9;
      case 0x57: this.a = this.i; this.f = (this.f & FC) | SZ[this.a] | (this.iff2 ? FPV : 0); return 9;
      case 0x5F: this.a = this.r & 0xFF; this.f = (this.f & FC) | SZ[this.a] | (this.iff2 ? FPV : 0); return 9;
      case 0x67: { // RRD
        const ad = this.getHL(), v = m[ad], a = this.a;
        m[ad] = ((a << 4) | (v >> 4)) & 0xFF;
        this.a = (a & 0xF0) | (v & 0x0F);
        this.f = (this.f & FC) | SZP[this.a];
        return 18;
      }
      case 0x6F: { // RLD
        const ad = this.getHL(), v = m[ad], a = this.a;
        m[ad] = ((v << 4) | (a & 0x0F)) & 0xFF;
        this.a = (a & 0xF0) | (v >> 4);
        this.f = (this.f & FC) | SZP[this.a];
        return 18;
      }

      // Block transfer
      case 0xA0: case 0xA8: case 0xB0: case 0xB8: {
        const hl = this.getHL(), de = this.getDE();
        const v = m[hl];
        m[de] = v;
        const dir = (op & 8) ? -1 : 1;
        this.setHL((hl + dir) & 0xFFFF); this.setDE((de + dir) & 0xFFFF);
        const bc = (this.getBC() - 1) & 0xFFFF; this.setBC(bc);
        const n = (v + this.a) & 0xFF;
        this.f = (this.f & (FS | FZ | FC)) | (bc ? FPV : 0) | (n & F3) | ((n << 4) & F5);
        if (op >= 0xB0 && bc) { this.pc = (this.pc - 2) & 0xFFFF; return 21; }
        return 16;
      }
      // Block compare
      case 0xA1: case 0xA9: case 0xB1: case 0xB9: {
        const hl = this.getHL();
        const v = m[hl], a = this.a;
        const r = (a - v) & 0xFF;
        this.setHL((hl + ((op & 8) ? -1 : 1)) & 0xFFFF);
        const bc = (this.getBC() - 1) & 0xFFFF; this.setBC(bc);
        const h = (a ^ v ^ r) & FH;
        const n = (r - (h ? 1 : 0)) & 0xFF;
        this.f = (this.f & FC) | FN | (SZ[r] & (FS | FZ)) | h | (bc ? FPV : 0) | (n & F3) | ((n << 4) & F5);
        if (op >= 0xB0 && bc && r !== 0) { this.pc = (this.pc - 2) & 0xFFFF; return 21; }
        return 16;
      }
      // Block input
      case 0xA2: case 0xAA: case 0xB2: case 0xBA: {
        const v = this.io.in(this.getBC()) & 0xFF;
        const hl = this.getHL();
        m[hl] = v;
        const dir = (op & 8) ? -1 : 1;
        this.setHL((hl + dir) & 0xFFFF);
        this.b = (this.b - 1) & 0xFF;
        const k = v + ((this.c + dir) & 0xFF);
        this.f = SZ[this.b] | ((v & 0x80) ? FN : 0) | (k > 255 ? FH | FC : 0) | (SZP[(k & 7) ^ this.b] & FPV);
        if (op >= 0xB0 && this.b) { this.pc = (this.pc - 2) & 0xFFFF; return 21; }
        return 16;
      }
      // Block output
      case 0xA3: case 0xAB: case 0xB3: case 0xBB: {
        const hl = this.getHL();
        const v = m[hl];
        this.b = (this.b - 1) & 0xFF;
        this.io.out(this.getBC(), v);
        const nhl = (hl + ((op & 8) ? -1 : 1)) & 0xFFFF;
        this.setHL(nhl);
        const k = v + (nhl & 0xFF);
        this.f = SZ[this.b] | ((v & 0x80) ? FN : 0) | (k > 255 ? FH | FC : 0) | (SZP[(k & 7) ^ this.b] & FPV);
        if (op >= 0xB0 && this.b) { this.pc = (this.pc - 2) & 0xFFFF; return 21; }
        return 16;
      }
    }
    return 8; // undefined ED opcode: NOP
  }
}

export default Z80;
