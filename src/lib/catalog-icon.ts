import sharp from "sharp";
import { privateS3 } from "./s3";

/** S3 object-key prefix for catalog icons (private bucket, no host stored). */
export const CATALOG_ICON_S3_PREFIX = "catalog/icons";

export const CATALOG_ICON_UPLOAD = {
  maxBytes: 2 * 1024 * 1024,
  allowedMimeTypes: new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
  allowedExtensions: new Set(["jpg", "jpeg", "png", "webp"]),
} as const;

const ICON_MAX_EDGE = 256;
const ICON_WEBP_QUALITY = 80;
const DISPLAY_URL_TTL_SECONDS = 3600;

export function catalogIconObjectKey(fileId: string) {
  return `${CATALOG_ICON_S3_PREFIX}/${fileId}.webp`;
}

export function isCatalogIconKey(value: string) {
  return value.startsWith(`${CATALOG_ICON_S3_PREFIX}/`) && !value.includes("://");
}

/** Resize and convert to WebP so list/grid icons stay small on mobile. */
export async function optimizeCatalogIcon(input: Buffer): Promise<{ buffer: Buffer; contentType: "image/webp" }> {
  try {
    const buffer = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(ICON_MAX_EDGE, ICON_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: ICON_WEBP_QUALITY, effort: 4 })
      .toBuffer();
    return { buffer, contentType: "image/webp" };
  } catch {
    throw new Error("INVALID_FILE_TYPE");
  }
}

/**
 * Persist either an S3 object key (no bucket host) or an external URL.
 * Full URLs for *our* bucket are reduced to the object key.
 */
export function normalizeStoredIconUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return s3KeyFromOurBucketUrl(trimmed) ?? trimmed;
}

export async function resolveCatalogIconDisplayUrl(stored: string | null): Promise<string | null> {
  if (!stored) return null;
  if (isCatalogIconKey(stored)) return privateS3.presignedGetUrl(stored, DISPLAY_URL_TTL_SECONDS);
  return stored;
}

export async function deleteCatalogIconIfStored(stored: string | null | undefined) {
  if (!stored || !isCatalogIconKey(stored)) return;
  await privateS3.delete(stored).catch(() => undefined);
}

function s3KeyFromOurBucketUrl(value: string): string | null {
  if (isCatalogIconKey(value)) return value;
  if (!/^https?:\/\//i.test(value)) return null;

  const bucket = process.env.AWS_S3_BUCKET?.trim();
  if (!bucket) return null;

  try {
    const url = new URL(value);
    const host = url.hostname;
    const path = decodeURIComponent(url.pathname.replace(/^\//, ""));

    if (host === `${bucket}.s3.amazonaws.com` || (host.startsWith(`${bucket}.s3.`) && host.endsWith(".amazonaws.com"))) {
      return path || null;
    }

    const pathStyle = host === "s3.amazonaws.com" || /^s3\.[a-z0-9-]+\.amazonaws\.com$/i.test(host);
    if (pathStyle && path.startsWith(`${bucket}/`)) {
      return path.slice(bucket.length + 1) || null;
    }
  } catch {
    return null;
  }

  return null;
}
