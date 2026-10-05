import { privateS3 } from "./s3";

/** S3 key prefixes for profile photos (private bucket). */
export const PROFILE_PHOTO_S3_PREFIX = {
  customer: "customers/profile",
  provider: "providers/profile",
} as const;

export const PROFILE_PHOTO_UPLOAD = {
  maxBytes: 2 * 1024 * 1024,
  allowedMimeTypes: new Set(["image/jpeg", "image/jpg", "image/png"]),
  allowedExtensions: new Set(["jpg", "jpeg", "png"]),
} as const;

export function profilePhotoObjectKey(actor: "customer" | "provider", actorId: string, fileId: string, ext: string) {
  const prefix = PROFILE_PHOTO_S3_PREFIX[actor];
  return `${prefix}/${actorId}/${fileId}.${ext}`;
}

export function isStoredS3Key(value: string) {
  return value.startsWith(PROFILE_PHOTO_S3_PREFIX.customer) || value.startsWith(PROFILE_PHOTO_S3_PREFIX.provider);
}

export async function resolveProfilePhotoDisplayUrl(stored: string | null) {
  if (!stored) return null;
  if (isStoredS3Key(stored)) return privateS3.presignedGetUrl(stored);
  return stored;
}
