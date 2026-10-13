export interface ImageHeader { width: number; height: number; orientation: number }

function tiffValues(tiff: Buffer): { width?: number; height?: number; orientation: number } {
  const result: { width?: number; height?: number; orientation: number } = { orientation: 1 };
  if (tiff.length < 8) return result;
  const order = tiff.toString("ascii", 0, 2);
  if (order !== "II" && order !== "MM") return result;
  const short = (offset: number) => order === "II" ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const long = (offset: number) => order === "II" ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  try {
    if (short(2) !== 42) return result;
    const ifd = long(4), count = short(ifd);
    for (let index = 0; index < count && ifd + 2 + (index + 1) * 12 <= tiff.length; index++) {
      const entry = ifd + 2 + index * 12;
      const tag = short(entry), type = short(entry + 2);
      if ((type !== 3 && type !== 4) || long(entry + 4) !== 1) continue;
      const value = type === 3 ? short(entry + 8) : long(entry + 8);
      if (tag === 0x100) result.width = value;
      if (tag === 0x101) result.height = value;
      if (tag === 0x112 && value >= 1 && value <= 8) result.orientation = value;
    }
  } catch { /* Malformed metadata must not break decoding of a valid image. */ }
  return result;
}

function exifOrientation(exif: Buffer): number {
  return exif.length >= 14 && exif.toString("ascii", 0, 6) === "Exif\0\0" ? tiffValues(exif.subarray(6)).orientation : 1;
}

/** Read dimensions without allocating the bitmap; JPEG also needs EXIF orientation. */
export function readImageHeader(source: Buffer): ImageHeader | null {
  if (source.length >= 24 && source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && source.toString("ascii", 12, 16) === "IHDR") {
    let orientation = 1, offset = 8;
    while (offset + 12 <= source.length) {
      const length = source.readUInt32BE(offset);
      if (offset + 12 + length > source.length) break;
      if (source.toString("ascii", offset + 4, offset + 8) === "eXIf") orientation = tiffValues(source.subarray(offset + 8, offset + 8 + length)).orientation;
      offset += length + 12;
    }
    return { width: source.readUInt32BE(16), height: source.readUInt32BE(20), orientation };
  }
  if (source.length >= 8 && ["II", "MM"].includes(source.toString("ascii", 0, 2))) {
    const values = tiffValues(source);
    return values.width && values.height ? {width:values.width, height:values.height, orientation:values.orientation} : null;
  }
  if (source.length >= 10 && /^GIF8[79]a$/.test(source.toString("ascii",0,6))) {
    return {width:source.readUInt16LE(6),height:source.readUInt16LE(8),orientation:1};
  }
  if (source.length >= 26 && source.toString("ascii",0,2) === "BM") {
    const dib = source.readUInt32LE(14);
    if (dib === 12) return {width:source.readUInt16LE(18),height:source.readUInt16LE(20),orientation:1};
    if (dib >= 40) return {width:source.readInt32LE(18),height:Math.abs(source.readInt32LE(22)),orientation:1};
  }
  if (source.length >= 30 && source.toString("ascii",0,4) === "RIFF" && source.toString("ascii",8,12) === "WEBP") {
    const type = source.toString("ascii",12,16);
    if (type === "VP8X") return {width:source.readUIntLE(24,3)+1,height:source.readUIntLE(27,3)+1,orientation:1};
    if (type === "VP8L" && source[20] === 0x2f) {
      const bits=source.readUInt32LE(21);
      return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1,orientation:1};
    }
    if (type === "VP8 " && source.subarray(23,26).equals(Buffer.from([0x9d,0x01,0x2a]))) return {width:source.readUInt16LE(26)&0x3fff,height:source.readUInt16LE(28)&0x3fff,orientation:1};
  }
  if (source.length < 4 || source[0] !== 0xff || source[1] !== 0xd8) return null;
  let offset = 2, orientation = 1;
  let dimensions: { width: number; height: number } | undefined;
  while (offset + 1 < source.length) {
    if (source[offset++] !== 0xff) break;
    while (source[offset] === 0xff) offset++;
    const marker = source[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > source.length) break;
    const length = source.readUInt16BE(offset);
    if (length < 2 || offset + length > source.length) break;
    if (marker === 0xe1) orientation = exifOrientation(source.subarray(offset + 2, offset + length));
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
      dimensions = { height: source.readUInt16BE(offset + 3), width: source.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return dimensions ? { ...dimensions, orientation } : null;
}
