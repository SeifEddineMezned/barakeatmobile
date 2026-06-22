/**
 * Patches assets/fonts/Chillax-Bold.ttf in place.
 *
 * The file shipped from Fontshare has a corrupted `name` table: the Family,
 * FullName, and PostScriptName records all contain the literal string
 * "false" (a build-time bug from whatever subsetter generated it) instead
 * of the real names. iOS registers the font under its PostScript name, so
 * `fontFamily="Chillax-Bold"` in code resolves to nothing on iOS and the
 * splash B silently falls back to the system font.
 *
 * This script:
 *   1. Parses the TTF table directory.
 *   2. Rebuilds the `name` table replacing the broken records with the
 *      correct strings.
 *   3. Recomputes the `name` table checksum.
 *   4. Recomputes the file-wide `head.checksumAdjustment`.
 *   5. Re-lays-out the file so all subsequent table offsets are consistent
 *      with the new (slightly larger) name table.
 *
 * Run with:  node Barakeat_app/barakeatmobile/scripts/patch-chillax-name-table.js
 *
 * Idempotent: running it twice produces the same output.
 */
const fs = require('fs');
const path = require('path');

const TTF_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Chillax-Bold.ttf');

const REPLACEMENTS = {
  1: 'Chillax',
  4: 'Chillax Bold',
  6: 'Chillax-Bold',
};

function checksumTable(data) {
  let sum = 0;
  const n = data.length;
  for (let i = 0; i < n; i += 4) {
    const b0 = data[i] || 0;
    const b1 = i + 1 < n ? data[i + 1] : 0;
    const b2 = i + 2 < n ? data[i + 2] : 0;
    const b3 = i + 3 < n ? data[i + 3] : 0;
    const word = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    sum = (sum + word) >>> 0;
  }
  return sum;
}

function patchTTF(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = dv.getUint16(4);

  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16;
    const tag = buf.slice(r, r + 4).toString('ascii');
    const offset = dv.getUint32(r + 8);
    const length = dv.getUint32(r + 12);
    tables.push({ tag, data: Buffer.from(buf.slice(offset, offset + length)) });
  }

  const nameTable = tables.find((t) => t.tag === 'name');
  if (!nameTable) throw new Error('no name table');

  const oldData = nameTable.data;
  const oldDv = new DataView(oldData.buffer, oldData.byteOffset, oldData.byteLength);
  const format = oldDv.getUint16(0);
  const count = oldDv.getUint16(2);
  const oldStorageOffset = oldDv.getUint16(4);

  const records = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platformID = oldDv.getUint16(r);
    const encodingID = oldDv.getUint16(r + 2);
    const languageID = oldDv.getUint16(r + 4);
    const nameID = oldDv.getUint16(r + 6);
    const len = oldDv.getUint16(r + 8);
    const off = oldDv.getUint16(r + 10);
    const stringBytes = oldData.slice(oldStorageOffset + off, oldStorageOffset + off + len);
    records.push({ platformID, encodingID, languageID, nameID, stringBytes });
  }

  for (const rec of records) {
    const newStr = REPLACEMENTS[rec.nameID];
    if (newStr === undefined) continue;
    if (rec.platformID === 1) {
      rec.stringBytes = Buffer.from(newStr, 'latin1');
    } else if (rec.platformID === 3 || rec.platformID === 0) {
      const b = Buffer.alloc(newStr.length * 2);
      for (let i = 0; i < newStr.length; i++) b.writeUInt16BE(newStr.charCodeAt(i), i * 2);
      rec.stringBytes = b;
    }
  }

  // Rebuild storage area + offsets
  let cursor = 0;
  const chunks = [];
  for (const rec of records) {
    rec.offset = cursor;
    rec.length = rec.stringBytes.length;
    chunks.push(rec.stringBytes);
    cursor += rec.length;
  }
  const newStorage = Buffer.concat(chunks);
  const newStorageOffset = 6 + count * 12;
  const newNameSize = newStorageOffset + newStorage.length;

  const newName = Buffer.alloc(newNameSize);
  const newDv = new DataView(newName.buffer, newName.byteOffset, newName.byteLength);
  newDv.setUint16(0, format);
  newDv.setUint16(2, count);
  newDv.setUint16(4, newStorageOffset);
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const rec = records[i];
    newDv.setUint16(r, rec.platformID);
    newDv.setUint16(r + 2, rec.encodingID);
    newDv.setUint16(r + 4, rec.languageID);
    newDv.setUint16(r + 6, rec.nameID);
    newDv.setUint16(r + 8, rec.length);
    newDv.setUint16(r + 10, rec.offset);
    rec.stringBytes.copy(newName, newStorageOffset + rec.offset);
  }
  nameTable.data = newName;

  // Compute per-table checksums (over unpadded data, with implicit zero pad to 4)
  for (const t of tables) {
    t.checksum = checksumTable(t.data);
  }

  // Zero head.checksumAdjustment before computing the file checksum
  const headTable = tables.find((t) => t.tag === 'head');
  if (!headTable) throw new Error('no head table');
  headTable.data.writeUInt32BE(0, 8);
  headTable.checksum = checksumTable(headTable.data);

  // Re-lay-out tables. Each padded to 4-byte boundary. Order kept same as
  // original (tables[] iteration matches the directory order from the file).
  const headerSize = 12 + tables.length * 16;
  let pos = headerSize;
  const padTo4 = (n) => (4 - (n % 4)) % 4;
  for (const t of tables) {
    t.newOffset = pos;
    t.length = t.data.length;
    pos += t.length + padTo4(t.length);
  }
  const totalSize = pos;
  const out = Buffer.alloc(totalSize);

  // Header (sfntVersion + numTables + searchRange + entrySelector + rangeShift)
  buf.slice(0, 12).copy(out, 0);

  // Table directory
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const r = 12 + i * 16;
    Buffer.from(t.tag, 'ascii').copy(out, r);
    out.writeUInt32BE(t.checksum, r + 4);
    out.writeUInt32BE(t.newOffset, r + 8);
    out.writeUInt32BE(t.length, r + 12);
  }

  for (const t of tables) t.data.copy(out, t.newOffset);

  // File-wide checksum adjustment lives in head at offset 8
  const fileSum = checksumTable(out);
  const adjustment = (0xB1B0AFBA - fileSum) >>> 0;
  out.writeUInt32BE(adjustment, headTable.newOffset + 8);

  return out;
}

const before = fs.readFileSync(TTF_PATH);
const after = patchTTF(before);
fs.writeFileSync(TTF_PATH, after);
console.log('Patched', TTF_PATH);
console.log('  before:', before.length, 'bytes');
console.log('  after: ', after.length, 'bytes');
