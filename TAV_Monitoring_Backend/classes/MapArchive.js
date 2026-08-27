const zlib = require("zlib");

function createArchive(entries) {
  const localParts = [], centralParts = [];
  let offset = 0;
  Object.keys(entries).forEach((name) => {
    const nameBytes = Buffer.from(name, "utf8");
    const source = Buffer.isBuffer(entries[name]) ? entries[name] : Buffer.from(entries[name]);
    const compressed = zlib.deflateRawSync(source);
    const checksum = crc32(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  });
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22), count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(localParts.concat([centralDirectory, end]));
}

function readArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw invalidArchive();
  const endOffset = findEndRecord(buffer), count = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const entries = {};
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw invalidArchive();
    const method = buffer.readUInt16LE(cursor + 10), compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24), nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (!name || name.includes("..") || name.startsWith("/") || name.startsWith("\\")) throw invalidArchive();
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw invalidArchive();
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (dataOffset + compressedSize > buffer.length || size > 20 * 1024 * 1024) throw invalidArchive();
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const value = method === 8 ? zlib.inflateRawSync(compressed) : (method === 0 ? Buffer.from(compressed) : null);
    if (!value || value.length !== size) throw invalidArchive();
    entries[name] = value;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndRecord(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw invalidArchive();
}
function invalidArchive() { const error = new Error("Fichier MapTav invalide"); error.status = 400; return error; }
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let result = value;
  for (let bit = 0; bit < 8; bit += 1) result = (result & 1) ? (0xedb88320 ^ (result >>> 1)) : (result >>> 1);
  return result >>> 0;
});
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
module.exports = { createArchive, readArchive };
