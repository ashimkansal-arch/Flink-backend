import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

let client: S3Client | null = null;

function bucket(): string {
  const name = process.env.AWS_S3_BUCKET?.trim();
  if (!name) throw new Error("STORAGE_NOT_CONFIGURED");
  return name;
}

function getS3Client() {
  if (client) return client;

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  client = new S3Client({
    region: process.env.AWS_REGION?.trim() || "us-east-1",
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    followRegionRedirects: true,
  });
  return client;
}

function storageErrorCode(err: unknown): string {
  if (err instanceof Error && err.message.startsWith("STORAGE_")) return err.message;

  const record = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
  const name = typeof record.name === "string" ? record.name : "";
  const awsCode =
    (typeof record.Code === "string" && record.Code) ||
    (typeof record.code === "string" && record.code) ||
    "";
  const http =
    record.$metadata && typeof record.$metadata === "object"
      ? Number((record.$metadata as { httpStatusCode?: number }).httpStatusCode)
      : undefined;
  const text = `${name} ${awsCode} ${err instanceof Error ? err.message : ""}`.toLowerCase();

  if (
    name === "CredentialsProviderError" ||
    awsCode === "InvalidAccessKeyId" ||
    awsCode === "SignatureDoesNotMatch" ||
    name === "InvalidAccessKeyId" ||
    name === "SignatureDoesNotMatch"
  ) {
    return "STORAGE_CREDENTIALS_INVALID";
  }
  if (name === "NoSuchBucket" || awsCode === "NoSuchBucket") return "STORAGE_BUCKET_NOT_FOUND";
  if (
    name === "PermanentRedirect" ||
    awsCode === "PermanentRedirect" ||
    awsCode === "AuthorizationHeaderMalformed" ||
    (text.includes("region") && (text.includes("incorrect") || text.includes("mismatch") || text.includes("does not match")))
  ) {
    return "STORAGE_REGION_MISMATCH";
  }
  if (
    name === "AccessDenied" ||
    awsCode === "AccessDenied" ||
    awsCode === "AllAccessDisabled" ||
    awsCode === "AccessDeniedException"
  ) {
    return "STORAGE_ACCESS_DENIED";
  }
  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    name === "NetworkingError" ||
    awsCode === "ETIMEDOUT" ||
    awsCode === "ECONNRESET" ||
    awsCode === "ENOTFOUND" ||
    awsCode === "EAI_AGAIN" ||
    awsCode === "SlowDown" ||
    awsCode === "ServiceUnavailable" ||
    http === 503
  ) {
    return "STORAGE_UNAVAILABLE";
  }
  return "STORAGE_FAILED";
}

async function withStorage<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = storageErrorCode(err);
    if (code !== "STORAGE_NOT_CONFIGURED") {
      const record = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
      console.error("S3 operation failed", {
        code,
        name: record.name,
        awsCode: record.Code ?? record.code,
        err,
      });
    }
    throw new Error(code);
  }
}

export const privateS3 = {
  upload(key: string, body: Buffer, contentType: string) {
    return withStorage(() =>
      getS3Client().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      ),
    );
  },

  delete(key: string) {
    return withStorage(() =>
      getS3Client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })),
    );
  },

  presignedGetUrl(key: string, expiresInSeconds = 900) {
    return withStorage(() =>
      getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
        expiresIn: expiresInSeconds,
      }),
    );
  },

  newFileId() {
    return randomUUID();
  },
};
