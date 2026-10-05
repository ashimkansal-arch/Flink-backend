import type { FastifyReply } from "fastify";
import { PROVIDER_ACCOUNT_ERROR_CODES } from "./auth/actor-status";

export const UPLOAD_ERROR_STATUS: Record<string, 400 | 403 | 502> = {
  FILE_TOO_LARGE: 400,
  INVALID_FILE_TYPE: 400,
  INVALID_DOCUMENT_TYPE: 400,
  INVALID_UPLOAD: 400,
  PROVIDER_KYC_UPLOAD_DISABLED: 403,
  STORAGE_NOT_CONFIGURED: 502,
  STORAGE_CREDENTIALS_INVALID: 502,
  STORAGE_BUCKET_NOT_FOUND: 502,
  STORAGE_ACCESS_DENIED: 502,
  STORAGE_REGION_MISMATCH: 502,
  STORAGE_UNAVAILABLE: 502,
  STORAGE_FAILED: 502,
};

export const UPLOAD_ERROR_MESSAGE: Record<string, string> = {
  FILE_TOO_LARGE: "This file is too large.",
  INVALID_FILE_TYPE: "This file type is not allowed.",
  INVALID_DOCUMENT_TYPE: "Choose a valid document type (ID proof or address proof).",
  INVALID_UPLOAD: "Choose a file to upload.",
  PROVIDER_KYC_UPLOAD_DISABLED: "Worker KYC self-upload is turned off.",
  STORAGE_NOT_CONFIGURED: "File storage is not configured. Contact support.",
  STORAGE_CREDENTIALS_INVALID: "Storage credentials are invalid. Contact support.",
  STORAGE_BUCKET_NOT_FOUND: "Storage bucket was not found. Contact support.",
  STORAGE_ACCESS_DENIED: "Storage access was denied. Contact support.",
  STORAGE_REGION_MISMATCH: "Storage region is misconfigured. Contact support.",
  STORAGE_UNAVAILABLE: "Storage is temporarily unavailable. Try again.",
  STORAGE_FAILED: "Could not save the file. Try again, or contact support if it keeps failing.",
};

export function sendUploadError(reply: FastifyReply, code: string) {
  const status = UPLOAD_ERROR_STATUS[code] ?? 400;
  return reply.code(status).send({
    error: code,
    message: UPLOAD_ERROR_MESSAGE[code] ?? code,
  });
}

export function replyUploadError(reply: FastifyReply, err: unknown): boolean {
  if (!(err instanceof Error) || !UPLOAD_ERROR_STATUS[err.message]) return false;
  sendUploadError(reply, err.message);
  return true;
}

export function replyProviderAccountError(reply: FastifyReply, err: unknown): boolean {
  if (!(err instanceof Error) || !PROVIDER_ACCOUNT_ERROR_CODES.has(err.message)) return false;
  reply.code(403).send({ error: err.message });
  return true;
}
