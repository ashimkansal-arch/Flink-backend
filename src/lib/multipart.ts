import type { FastifyRequest } from "fastify";
import { UPLOAD_FORM_FIELDS } from "./upload-form";

type ParsedFile = {
  filename: string;
  mimetype: string;
  buffer: Buffer;
};

const FILE_FIELD_ALIASES = new Set([
  UPLOAD_FORM_FIELDS.file,
  "photo",
  "image",
  "picture",
  "profilePhoto",
  "profile_photo",
  "profileImage",
  "profile_image",
]);

async function readMultipartParts(request: FastifyRequest) {
  const fields: Record<string, string> = {};
  const files: Record<string, ParsedFile> = {};
  let file: ParsedFile | undefined;

  for await (const part of request.parts()) {
    if (part.type === "field") {
      fields[part.fieldname] = String(part.value).trim();
      continue;
    }
    if (part.type !== "file") continue;

    // Always drain the stream. Skipping a file part hangs Busboy and the proxy returns 502.
    const parsed: ParsedFile = {
      filename: part.filename?.trim() || "upload",
      mimetype: part.mimetype?.trim() || "application/octet-stream",
      buffer: await part.toBuffer(),
    };
    files[part.fieldname] = parsed;
    const preferred = FILE_FIELD_ALIASES.has(part.fieldname);
    if (!file || preferred) file = parsed;
  }

  return { fields, files, file };
}

const emptyFile = { filename: "", mimetype: "", buffer: undefined as Buffer | undefined };

export async function readMultipartFile(request: FastifyRequest) {
  const { file } = await readMultipartParts(request);
  if (!file) return emptyFile;
  return file;
}

export async function readMultipartReview(request: FastifyRequest) {
  const { fields, file } = await readMultipartParts(request);
  return {
    rating: fields.rating,
    description: fields.description || fields.comment,
    comment: fields.comment,
    tags: fields.tags,
    file,
  };
}

export async function readMultipartCompleteJob(request: FastifyRequest) {
  const { files } = await readMultipartParts(request);
  const selfie =
    files[UPLOAD_FORM_FIELDS.selfie] ??
    files[UPLOAD_FORM_FIELDS.file] ??
    files.photo ??
    files.image;
  const completionPhoto = files[UPLOAD_FORM_FIELDS.completionPhoto] ?? files.servicePhoto;
  return { selfie, completionPhoto };
}

export async function readMultipartKycUpload<T extends string>(
  request: FastifyRequest,
  allowedDocumentTypes: readonly T[],
) {
  const allowed = new Set(allowedDocumentTypes);
  const { fields, file } = await readMultipartParts(request);
  const rawType = fields[UPLOAD_FORM_FIELDS.documentType];
  const documentType = allowed.has(rawType as T) ? (rawType as T) : undefined;

  if (!file) {
    return { documentType, ...emptyFile };
  }

  return { documentType, filename: file.filename, mimetype: file.mimetype, buffer: file.buffer };
}
