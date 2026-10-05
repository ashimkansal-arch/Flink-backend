import { z } from "zod";

// Shared across customer/provider/admin auth routes — all three issue the same token shape.
export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

export const genderSchema = z.enum(["male", "female", "other"]).nullable();

export const authErrorResponses = {
  401: errorResponseSchema,
  403: errorResponseSchema,
} as const;

export const otpDeliveryErrorResponses = {
  401: errorResponseSchema,
  403: errorResponseSchema,
  502: errorResponseSchema,
} as const;

export const authedErrorResponses = {
  ...authErrorResponses,
  404: errorResponseSchema,
} as const;
