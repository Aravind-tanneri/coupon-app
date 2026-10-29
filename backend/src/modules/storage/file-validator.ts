import crypto from "crypto";
import { BadRequestError } from "../../lib/errors.js";

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB ceiling (§25)
export const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export interface ValidatedFileResult {
  buffer: Buffer;
  mime: string;
  sha256: string;
  extension: "jpg" | "png" | "pdf";
}

/**
 * Validates inbound media against magic bytes, size limits, and malicious payloads (§25).
 */
export function validateMediaFile(
  rawBuffer: Buffer,
  declaredMime?: string,
  filename?: string,
): ValidatedFileResult {
  // 1. Size ceiling check
  if (rawBuffer.length > MAX_FILE_SIZE_BYTES) {
    throw new BadRequestError(
      `File size (${(rawBuffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds 5 MB limit`,
    );
  }

  if (rawBuffer.length < 16) {
    throw new BadRequestError("File is empty or corrupted");
  }

  // 2. Magic byte verification (ignoring declared extension/mime)
  let detectedMime: string | null = null;
  let extension: "jpg" | "png" | "pdf" | null = null;

  // JPEG magic bytes: FF D8 FF
  if (rawBuffer[0] === 0xff && rawBuffer[1] === 0xd8 && rawBuffer[2] === 0xff) {
    detectedMime = "image/jpeg";
    extension = "jpg";
  }
  // PNG magic bytes: 89 50 4E 47 (\x89PNG)
  else if (
    rawBuffer[0] === 0x89 &&
    rawBuffer[1] === 0x50 &&
    rawBuffer[2] === 0x4e &&
    rawBuffer[3] === 0x47
  ) {
    detectedMime = "image/png";
    extension = "png";
  }
  // PDF magic bytes: 25 50 44 46 (%PDF)
  else if (
    rawBuffer[0] === 0x25 &&
    rawBuffer[1] === 0x50 &&
    rawBuffer[2] === 0x44 &&
    rawBuffer[3] === 0x46
  ) {
    detectedMime = "application/pdf";
    extension = "pdf";
  }

  if (!detectedMime || !extension || !ALLOWED_MIME_TYPES.has(detectedMime)) {
    throw new BadRequestError(
      "Unsupported file format. Only JPEG, PNG images and PDF documents are allowed.",
    );
  }

  // 3. Extension check: reject if filename has conflicting extension (e.g. .exe renamed to .jpg)
  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext && ext !== extension && !(extension === "jpg" && (ext === "jpeg" || ext === "jpg"))) {
      throw new BadRequestError(
        `File extension .${ext} does not match detected format ${detectedMime}`,
      );
    }
  }

  let sanitizedBuffer = rawBuffer;

  // 4. Content inspection
  if (detectedMime === "application/pdf") {
    // Basic malicious PDF check: reject embedded JavaScript or launch actions (§25)
    const contentStr = rawBuffer.toString("binary");
    if (
      contentStr.includes("/JavaScript") ||
      contentStr.includes("/JS") ||
      contentStr.includes("/Launch") ||
      contentStr.includes("/EmbeddedFiles")
    ) {
      throw new BadRequestError("PDF rejected: contains embedded scripts or external actions.");
    }
  } else if (detectedMime === "image/jpeg") {
    // Strip EXIF metadata APP1 marker (FF E1) if present
    sanitizedBuffer = stripJpegExif(rawBuffer);
  }

  // 5. Compute SHA-256 integrity hash
  const sha256 = crypto.createHash("sha256").update(sanitizedBuffer).digest("hex");

  return {
    buffer: sanitizedBuffer,
    mime: detectedMime,
    sha256,
    extension,
  };
}

/**
 * Strips EXIF APP1 metadata markers from JPEG images (§25).
 */
function stripJpegExif(buffer: Buffer): Buffer {
  let offset = 2; // Skip SOI (FF D8)
  const chunks: Buffer[] = [buffer.subarray(0, 2)];

  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) {
      break;
    }

    const marker = buffer[offset + 1];

    // Standalone markers without length: SOI, EOI, RST0-7
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)
    ) {
      chunks.push(buffer.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    const length = buffer.readUInt16BE(offset + 2);

    // APP1 marker (0xFF 0xE1) carries EXIF metadata
    if (marker === 0xe1) {
      // Skip EXIF chunk
      offset += 2 + length;
    } else {
      chunks.push(buffer.subarray(offset, offset + 2 + length));
      offset += 2 + length;
    }

    // Stop at Start of Scan (SOS - FF DA)
    if (marker === 0xda) {
      chunks.push(buffer.subarray(offset));
      break;
    }
  }

  return Buffer.concat(chunks);
}
