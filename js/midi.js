// Standard MIDI File パーサー
// 結果: { events: [{t, type, ch, a, b}], duration, title, channels: [{programs:Set, notes}] }
// type: 'on' | 'off' | 'cc' | 'pc' | 'pb'

export function parseMidi(buf) {
  const d = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); return s; };

  // RIFF MIDI (.rmi) 対応
  if (str(4) === 'RIFF') {
    p = 12;
    while (p < d.byteLength - 8) {
      const id = str(4); const len = d.getUint32(p + 4, true);
      if (id === 'data') { p += 8; break; }
      p += 8 + len + (len & 1);
    }
  }
  // 先頭にゴミがあるファイル対策
  const start = findStr(d, 'MThd', p);
  if (start < 0) throw new Error('MIDIファイルではありません (MThd が見つかりません)');
  p = start;

  const hdrLen = d.getUint32(p + 4);
  const ntrks = d.getUint16(p + 10);
  const division = d.getUint16(p + 12);
  p += 8 + hdrLen;

  const raw = []; // {tick, seq, kind, ...}
  let seq = 0;
  let title = '';

  for (let t = 0; t < ntrks && p < d.byteLength - 8; t++) {
    const pos = findStr(d, 'MTrk', p);
    if (pos < 0) break;
    p = pos;
    const len = d.getUint32(p + 4);
    let q = p + 8;
    const end = Math.min(q + len, d.byteLength);
    p = end;
    let tick = 0, status = 0;
    const vlq = () => { let v = 0, b; do { b = d.getUint8(q++); v = (v << 7) | (b & 0x7f); } while (b & 0x80 && q < end); return v; };

    while (q < end) {
      tick += vlq();
      if (q >= end) break;
      let b = d.getUint8(q);
      if (b & 0x80) { status = b; q++; }
      else if (status < 0x80) { q++; continue; } // 不正データはスキップ
      const s = status;
      if (s === 0xff) {
        const type = d.getUint8(q++); const l = vlq();
        if (type === 0x51 && l >= 3) {
          const tempo = (d.getUint8(q) << 16) | (d.getUint8(q + 1) << 8) | d.getUint8(q + 2);
          raw.push({ tick, seq: seq++, kind: 'tempo', tempo });
        } else if (type === 0x03 && !title && t <= 1) {
          const bytes = new Uint8Array(d.buffer, d.byteOffset + q, l);
          try { title = new TextDecoder('shift_jis', { fatal: true }).decode(bytes).trim(); }
          catch { title = Array.from(bytes, (b) => String.fromCharCode(b)).join('').trim(); }
        } else if (type === 0x2f) { q += l; break; }
        q += l;
        status = 0;
      } else if (s === 0xf0 || s === 0xf7) {
        const l = vlq(); q += l; status = 0;
      } else {
        const hi = s & 0xf0, ch = s & 0x0f;
        const a = d.getUint8(q++);
        const b2 = (hi === 0xc0 || hi === 0xd0) ? 0 : d.getUint8(q++);
        if (hi === 0x90) raw.push({ tick, seq: seq++, kind: b2 ? 'on' : 'off', ch, a, b: b2 });
        else if (hi === 0x80) raw.push({ tick, seq: seq++, kind: 'off', ch, a, b: 0 });
        else if (hi === 0xb0) raw.push({ tick, seq: seq++, kind: 'cc', ch, a, b: b2 });
        else if (hi === 0xc0) raw.push({ tick, seq: seq++, kind: 'pc', ch, a, b: 0 });
        else if (hi === 0xe0) raw.push({ tick, seq: seq++, kind: 'pb', ch, a: ((b2 << 7) | a) - 8192, b: 0 });
      }
    }
  }

  raw.sort((x, y) => x.tick - y.tick || x.seq - y.seq);

  // tick → 秒
  let secPerTick;
  const smpte = division & 0x8000;
  if (smpte) {
    const fps = 256 - (division >> 8);
    secPerTick = 1 / (fps * (division & 0xff));
  } else secPerTick = 0.5 / division;

  const events = [];
  const channels = Array.from({ length: 16 }, () => ({ programs: new Set(), notes: 0 }));
  let lastTick = 0, time = 0;
  for (const e of raw) {
    time += (e.tick - lastTick) * secPerTick;
    lastTick = e.tick;
    if (e.kind === 'tempo') { if (!smpte) secPerTick = e.tempo / 1e6 / division; continue; }
    events.push({ t: time, type: e.kind, ch: e.ch, a: e.a, b: e.b });
    if (e.kind === 'on') channels[e.ch].notes++;
    if (e.kind === 'pc') channels[e.ch].programs.add(e.a);
  }
  for (const c of channels) if (c.notes && !c.programs.size) c.programs.add(0);

  const duration = events.length ? events[events.length - 1].t : 0;
  return { events, duration, title, channels };
}

function findStr(d, s, from) {
  const n = d.byteLength - 4;
  for (let i = from; i <= n; i++) {
    if (d.getUint8(i) === s.charCodeAt(0) && d.getUint8(i + 1) === s.charCodeAt(1) &&
        d.getUint8(i + 2) === s.charCodeAt(2) && d.getUint8(i + 3) === s.charCodeAt(3)) return i;
  }
  return -1;
}

export const GM_NAMES = ['Acoustic Grand Piano','Bright Acoustic Piano','Electric Grand Piano','Honky-tonk Piano','Electric Piano 1','Electric Piano 2','Harpsichord','Clavinet','Celesta','Glockenspiel','Music Box','Vibraphone','Marimba','Xylophone','Tubular Bells','Dulcimer','Drawbar Organ','Percussive Organ','Rock Organ','Church Organ','Reed Organ','Accordion','Harmonica','Tango Accordion','Nylon Guitar','Steel Guitar','Jazz Guitar','Clean Guitar','Muted Guitar','Overdriven Guitar','Distortion Guitar','Guitar Harmonics','Acoustic Bass','Finger Bass','Pick Bass','Fretless Bass','Slap Bass 1','Slap Bass 2','Synth Bass 1','Synth Bass 2','Violin','Viola','Cello','Contrabass','Tremolo Strings','Pizzicato Strings','Orchestral Harp','Timpani','String Ensemble 1','String Ensemble 2','Synth Strings 1','Synth Strings 2','Choir Aahs','Voice Oohs','Synth Voice','Orchestra Hit','Trumpet','Trombone','Tuba','Muted Trumpet','French Horn','Brass Section','Synth Brass 1','Synth Brass 2','Soprano Sax','Alto Sax','Tenor Sax','Baritone Sax','Oboe','English Horn','Bassoon','Clarinet','Piccolo','Flute','Recorder','Pan Flute','Blown Bottle','Shakuhachi','Whistle','Ocarina','Square Lead','Saw Lead','Calliope Lead','Chiff Lead','Charang Lead','Voice Lead','Fifths Lead','Bass + Lead','New Age Pad','Warm Pad','Polysynth Pad','Choir Pad','Bowed Pad','Metallic Pad','Halo Pad','Sweep Pad','Rain FX','Soundtrack FX','Crystal FX','Atmosphere FX','Brightness FX','Goblins FX','Echoes FX','Sci-fi FX','Sitar','Banjo','Shamisen','Koto','Kalimba','Bagpipe','Fiddle','Shanai','Tinkle Bell','Agogo','Steel Drums','Woodblock','Taiko Drum','Melodic Tom','Synth Drum','Reverse Cymbal','Guitar Fret Noise','Breath Noise','Seashore','Bird Tweet','Telephone Ring','Helicopter','Applause','Gunshot'];
