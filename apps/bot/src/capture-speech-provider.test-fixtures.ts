/** In-memory structural Opus fixture; no recording, microphone or provider call. */
export function speechOgg(packetCount = 1): Uint8Array {
  const pages: Uint8Array[] = [];
  const head = new Uint8Array(19);
  head.set(Buffer.from("OpusHead"));
  head[8] = 1;
  head[9] = 1;
  const tags = new Uint8Array(16);
  tags.set(Buffer.from("OpusTags"));
  const page = (flags: number, granule: number, packets: Uint8Array[]) => {
    const sizes: number[] = [];
    for (const p of packets) {
      for (let left = p.length; left >= 255; left -= 255) sizes.push(255);
      sizes.push(p.length % 255);
    }
    const bytes = new Uint8Array(
      27 + sizes.length + packets.reduce((n, p) => n + p.length, 0),
    );
    const view = Buffer.from(bytes.buffer);
    bytes.set(Buffer.from("OggS"));
    bytes[5] = flags;
    view.writeBigUInt64LE(BigInt(granule), 6);
    view.writeUInt32LE(42, 14);
    view.writeUInt32LE(pages.length, 18);
    bytes[26] = sizes.length;
    bytes.set(sizes, 27);
    let cursor = 27 + sizes.length;
    for (const p of packets) {
      bytes.set(p, cursor);
      cursor += p.length;
    }
    let crc = 0;
    for (const byte of bytes) {
      crc = (crc ^ (byte << 24)) >>> 0;
      for (let bit = 0; bit < 8; bit++)
        crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
    }
    view.writeUInt32LE(crc, 22);
    pages.push(bytes);
  };
  page(2, 0, [head]);
  page(0, 0, [tags]);
  for (let start = 0; start < packetCount; start += 250) {
    const count = Math.min(250, packetCount - start);
    page(
      start + count === packetCount ? 4 : 0,
      (start + count) * 960,
      Array.from({ length: count }, () => Uint8Array.of(0x98, 0)),
    );
  }
  return new Uint8Array(Buffer.concat(pages));
}
