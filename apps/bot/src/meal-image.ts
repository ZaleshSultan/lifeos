import { DailyLifeInputError } from "@lifeos/core";

export function validateMealImage(
  mimeType: unknown,
  base64: unknown,
): { mimeType: string; imageBase64: string; estimatedTokens: number } {
  if (
    typeof mimeType !== "string" ||
    !["image/jpeg", "image/png", "image/webp"].includes(mimeType) ||
    typeof base64 !== "string" ||
    base64.length < 16 ||
    base64.length > 720000 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new DailyLifeInputError(
      "Use a compressed JPEG, PNG or WebP under 500 KB",
    );
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > 500000)
    throw new DailyLifeInputError("Use an image under 500 KB");
  let width = 0,
    height = 0;
  if (mimeType === "image/png") {
    if (
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      throw new DailyLifeInputError("Invalid PNG");
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (mimeType === "image/jpeg") {
    if (bytes[0] !== 255 || bytes[1] !== 216)
      throw new DailyLifeInputError("Invalid JPEG");
    for (let offset = 2; offset + 8 < bytes.length; ) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 217 || marker === 218) break;
      if (marker === 0 || marker === 255) continue;
      if (offset + 2 > bytes.length) break;
      const len = bytes.readUInt16BE(offset);
      if (len < 2 || offset + len > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += len;
    }
  } else {
    if (
      bytes.length < 30 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP"
    )
      throw new DailyLifeInputError("Invalid WebP");
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (
      kind === "VP8 " &&
      bytes[23] === 157 &&
      bytes[24] === 1 &&
      bytes[25] === 42
    ) {
      width = bytes.readUInt16LE(26) & 16383;
      height = bytes.readUInt16LE(28) & 16383;
    }
  }
  if (
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width * height > 16_000_000
  )
    throw new DailyLifeInputError(
      "Image dimensions are unsupported; use a smaller JPEG",
    );
  return {
    mimeType,
    imageBase64: base64,
    estimatedTokens: Math.max(width, height) <= 1536 ? 32768 : 80000,
  };
}
