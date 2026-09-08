const fs = require("fs");
const path = require("path");

function icoFromPngs(entries) {
  const count = entries.length;
  let offset = 6 + 16 * count;
  const header = Buffer.alloc(offset);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const parts = [header];
  entries.forEach(({ size, buf }, i) => {
    const o = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, o);
    header.writeUInt8(size >= 256 ? 0 : size, o + 1);
    header.writeUInt8(0, o + 2);
    header.writeUInt8(0, o + 3);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(buf.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    parts.push(buf);
    offset += buf.length;
  });
  return Buffer.concat(parts);
}

const dir = __dirname;
const entries = [16, 32, 48, 256].map((size) => ({
  size,
  buf: fs.readFileSync(path.join(dir, `icon-${size}.png`)),
}));
const ico = icoFromPngs(entries);
fs.writeFileSync(path.join(dir, "icon.ico"), ico);
console.log("wrote icon.ico", ico.length);
