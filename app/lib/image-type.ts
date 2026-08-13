// Magic-byte identification for the image uploads the product renders back to
// people (headshots, profile photos).
//
// A declared MIME type is whatever the uploader's browser, or an attacker's curl
// invocation, chose to say. Serving that back on our own origin is how an "image"
// becomes same-origin HTML. So the four raster formats we support are recognised
// from the bytes, and anything else is refused at upload time rather than sanitised
// at serve time.

export type RasterImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export const RASTER_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
export const RASTER_HELP = "PNG, JPEG, WebP, or GIF, up to 5 MB.";
export const RASTER_REJECTED = "That file is not a PNG, JPEG, WebP, or GIF image. Upload one of those formats.";

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** The image type these bytes actually are, or null for anything else. */
export function sniffImageType(data: ArrayBuffer | Uint8Array): RasterImageType | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 12) return null;

  // PNG: \x89PNG\r\n\x1a\n
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // GIF: GIF87a / GIF89a
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return "image/gif";
  }
  // WebP: "RIFF" ....  "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";

  return null;
}
