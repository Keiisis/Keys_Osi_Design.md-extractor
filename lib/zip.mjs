/**
 * Dependency-free ZIP writer.
 *
 * Files are compressed with deflate-raw through the native
 * CompressionStream API when available (Chrome 103+, Node 21+),
 * otherwise stored uncompressed (STORE). Both forms are valid ZIP
 * archives readable by every extractor.
 */

const CRC_TABLE = buildCrcTable();

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  const dosTime =
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { dosTime, dosDate };
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === "undefined") {
    return null;
  }
  let stream;
  try {
    stream = new CompressionStream("deflate-raw");
  } catch (error) {
    return null;
  }
  const compressed = new Response(
    new Blob([bytes]).stream().pipeThrough(stream)
  );
  return new Uint8Array(await compressed.arrayBuffer());
}

/**
 * Builds a ZIP archive.
 *
 * @param {Array<{ path: string, data: Uint8Array }>} files
 * @param {{ compress?: boolean, date?: Date }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function createZip(files, options = {}) {
  const compress = options.compress !== false;
  const { dosTime, dosDate } = dosDateTime(options.date);
  const encoder = new TextEncoder();

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(String(file.path).replace(/\\/g, "/"));
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const checksum = crc32(data);

    let stored = data;
    let method = 0; // STORE
    if (compress && data.length > 64) {
      const deflated = await deflateRaw(data);
      if (deflated && deflated.length < data.length) {
        stored = deflated;
        method = 8; // DEFLATE
      }
    }

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filenames flag
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, stored.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, stored.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // relative offset of local header
    central.set(nameBytes, 46);

    localParts.push(local, stored);
    centralParts.push(central);
    offset += local.length + stored.length;
  }

  // No ZIP64: fail loudly instead of writing a silently corrupt archive.
  if (files.length > 0xffff || offset > 0xffffffff) {
    throw new Error("Archive too large for ZIP (more than 65535 files or 4 GB).");
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory signature
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}
