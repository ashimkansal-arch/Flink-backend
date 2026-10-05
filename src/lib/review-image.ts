import sharp from "sharp";
import { privateS3 } from "./s3";

export const REVIEW_IMAGE_S3_PREFIX = "reviews/images";

export const REVIEW_IMAGE_UPLOAD = {
  maxBytes: 5 * 1024 * 1024,
  allowedMimeTypes: new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
  allowedExtensions: new Set(["jpg", "jpeg", "png", "webp"]),
} as const;

const DISPLAY_URL_TTL_SECONDS = 3600;

export function reviewImageObjectKey(bookingId: string, fileId: string) {
  return `${REVIEW_IMAGE_S3_PREFIX}/${bookingId}/${fileId}.webp`;
}

export function isReviewImageKey(value: string) {
  return value.startsWith(`${REVIEW_IMAGE_S3_PREFIX}/`) && !value.includes("://");
}

export async function optimizeReviewImage(input: Buffer): Promise<{ buffer: Buffer; contentType: "image/webp" }> {
  try {
    const buffer = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
    return { buffer, contentType: "image/webp" };
  } catch {
    throw new Error("INVALID_FILE_TYPE");
  }
}

export async function resolveReviewImageDisplayUrl(stored: string | null): Promise<string | null> {
  if (!stored) return null;
  if (isReviewImageKey(stored)) return privateS3.presignedGetUrl(stored, DISPLAY_URL_TTL_SECONDS);
  return stored;
}
