// Generates assets/G-paster.ico (multi-resolution, PNG-compressed) from assets/G-paster-mono.png
// (the pure-black auto-fit "Gp" glyph on a transparent background).
// Runs under Electron so nativeImage can decode and high-quality resize the source.
const { nativeImage } = require('electron');
const fs = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const source = join(root, 'assets', 'G-paster-mono.png');
const target = join(root, 'assets', 'G-paster.ico');
const sizes = [256, 128, 64, 48, 32, 24, 16];

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type 1 = icon
  header.writeUInt16LE(images.length, 4); // image count
  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  const blobs = [];
  images.forEach(({ size, data }, index) => {
    const base = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, base);      // width (0 encodes 256)
    directory.writeUInt8(size >= 256 ? 0 : size, base + 1);  // height (0 encodes 256)
    directory.writeUInt8(0, base + 2);   // palette count
    directory.writeUInt8(0, base + 3);   // reserved
    directory.writeUInt16LE(1, base + 4);        // color planes
    directory.writeUInt16LE(32, base + 6);       // bits per pixel
    directory.writeUInt32LE(data.length, base + 8);  // resource size
    directory.writeUInt32LE(offset, base + 12);      // resource offset
    blobs.push(data);
    offset += data.length;
  });
  return Buffer.concat([header, directory, ...blobs]);
}

const sourceImage = nativeImage.createFromPath(source);
if (sourceImage.isEmpty()) throw new Error(`Could not decode ${source}`);
const images = sizes.map(size => ({
  size,
  data: sourceImage.resize({ width: size, height: size, quality: 'best' }).toPNG(),
}));
fs.writeFileSync(target, buildIco(images));

const written = fs.readFileSync(target);
if (written.readUInt16LE(0) !== 0 || written.readUInt16LE(2) !== 1 || written.readUInt16LE(4) !== sizes.length) {
  throw new Error('Generated .ico failed header validation');
}
console.log(`Generated ${target} (${sizes.join('/')}px, ${written.length} bytes)`);
process.exit(0);
