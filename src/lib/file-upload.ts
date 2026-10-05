export function extensionFromFilename(filename: string): string {
  const base = filename.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function sniffImageType(buffer: Buffer): { ext: "jpg" | "png" | "webp"; mimetype: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", mimetype: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mimetype: "image/png" };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { ext: "webp", mimetype: "image/webp" };
  }
  return null;
}

/** Flutter/Dio often sends `application/octet-stream` and a filename with no extension. */
export function normalizeImageUpload(file: { filename: string; mimetype: string; buffer: Buffer }) {
  const sniffed = sniffImageType(file.buffer);
  if (!sniffed) return file;

  const mimetype =
    file.mimetype === "application/octet-stream" || !file.mimetype.toLowerCase().startsWith("image/")
      ? sniffed.mimetype
      : file.mimetype;
  const ext = extensionFromFilename(file.filename);
  const filename = ext ? file.filename : `${file.filename.replace(/\.+$/, "") || "photo"}.${sniffed.ext}`;
  return { filename, mimetype, buffer: file.buffer };
}

export function validateFileUpload(
  mimetype: string,
  extension: string,
  size: number,
  rules: {
    maxBytes: number;
    allowedMimeTypes: ReadonlySet<string>;
    allowedExtensions: ReadonlySet<string>;
  },
) {
  if (size > rules.maxBytes) throw new Error("FILE_TOO_LARGE");
  if (!rules.allowedMimeTypes.has(mimetype.toLowerCase())) throw new Error("INVALID_FILE_TYPE");
  if (!rules.allowedExtensions.has(extension.toLowerCase())) throw new Error("INVALID_FILE_TYPE");
}
