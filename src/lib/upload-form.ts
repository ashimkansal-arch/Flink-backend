import { z } from "zod";

/** Standard multipart field names for upload endpoints. */
export const UPLOAD_FORM_FIELDS = {
  file: "file",
  selfie: "selfie",
  completionPhoto: "completionPhoto",
  documentType: "documentType",
} as const;

/**
 * Swagger/docs only — multipart is parsed via `request.parts()`, not JSON body validation.
 * `@fastify/multipart` leaves `request.body` undefined unless `attachFieldsToBody` is on,
 * so these schemas must accept undefined or every upload returns 400.
 */
export const profilePhotoMultipartBodySchema = z.preprocess(
  (value) => (value == null ? {} : value),
  z.object({
    [UPLOAD_FORM_FIELDS.file]: z
      .any()
      .optional()
      .describe("Profile photo — JPG, JPEG, or PNG (max 2 MB)"),
  }),
);

export const catalogIconMultipartBodySchema = z.preprocess(
  (value) => (value == null ? {} : value),
  z.object({
    [UPLOAD_FORM_FIELDS.file]: z
      .any()
      .optional()
      .describe("Catalog icon — JPG, PNG, or WebP (max 2 MB). Optimized to 256px WebP."),
  }),
);

export const reviewMultipartBodySchema = z.preprocess(
  (value) => (value == null ? {} : value),
  z.object({
    rating: z.coerce.number().int().min(1).max(5).optional().describe("Star rating 1–5"),
    description: z.string().max(1000).optional().describe("Written review"),
    comment: z.string().max(1000).optional().describe("Alias of description"),
    tags: z.string().optional().describe("Comma-separated or JSON list of what went well"),
    [UPLOAD_FORM_FIELDS.file]: z
      .any()
      .optional()
      .describe("Optional photo — JPG, PNG, or WebP (max 5 MB)"),
  }),
);

export const completeJobMultipartBodySchema = z.preprocess(
  (value) => (value == null ? {} : value),
  z.object({
    [UPLOAD_FORM_FIELDS.selfie]: z
      .any()
      .optional()
      .describe("Required worker selfie — JPG, PNG, or WebP (max 5 MB). Also accepts file."),
    [UPLOAD_FORM_FIELDS.completionPhoto]: z
      .any()
      .optional()
      .describe("Optional photo of the completed service — JPG, PNG, or WebP (max 5 MB)."),
  }),
);

export const providerKycDocumentMultipartBodySchema = z.preprocess(
  (value) => (value == null ? {} : value),
  z.object({
    [UPLOAD_FORM_FIELDS.documentType]: z
      .enum(["id_proof", "address_proof"])
      .optional()
      .describe("KYC document type"),
    [UPLOAD_FORM_FIELDS.file]: z
      .any()
      .optional()
      .describe("Document file — JPG, JPEG, PNG, or PDF (max 5 MB)"),
  }),
);