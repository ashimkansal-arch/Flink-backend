import { privateS3 } from "./s3";

const PREFIX = "bookings/complete";

export function completionPhotoObjectKey(bookingId: string, kind: "selfie" | "photo", fileId: string) {
  return `${PREFIX}/${bookingId}/${kind}-${fileId}.webp`;
}

export async function resolveCompletionPhotoDisplayUrl(stored: string | null) {
  if (!stored) return null;
  if (stored.startsWith(`${PREFIX}/`) && !stored.includes("://")) {
    return privateS3.presignedGetUrl(stored, 3600);
  }
  return stored;
}
