import { customerService } from "./customer-service";
import { providerService } from "./provider-service";
import { authService } from "./auth-service";
import { serviceCategoryRepository } from "../repositories/service-category-repository";
import { userRepository } from "../repositories/user-repository";
import { serviceProviderRepository } from "../repositories/service-provider-repository";
import { privateS3 } from "../lib/s3";
import { extensionFromFilename, normalizeImageUpload, validateFileUpload } from "../lib/file-upload";
import {
  isStoredS3Key,
  PROFILE_PHOTO_UPLOAD,
  profilePhotoObjectKey,
  resolveProfilePhotoDisplayUrl,
} from "../lib/profile-photo";

function profilePhotoUrl(stored: string | null) {
  return resolveProfilePhotoDisplayUrl(stored).catch(() => null);
}

async function resolveServiceCategories(keys: string[]) {
  try {
    return await serviceCategoryRepository.findManyRefsByKeys(keys);
  } catch {
    return [];
  }
}

export const meService = {
  async getProfile(auth: {
    type: "customer" | "provider" | "admin" | "supervisor";
    id: string;
    role?: string;
  }) {
    if (auth.type === "admin") {
      return authService.me("admin", auth.id, auth.role);
    }
    if (auth.type === "supervisor") {
      return authService.me("supervisor", auth.id);
    }

    if (auth.type === "customer") {
      const { profileImageUrl, ...profile } = await customerService.getProfile(auth.id);
      return {
        type: "customer" as const,
        ...profile,
        profilePhotoUrl: await profilePhotoUrl(profileImageUrl),
      };
    }

    const [profile, stats] = await Promise.all([
      providerService.getProfile(auth.id),
      providerService.getStats(auth.id),
    ]);
    const serviceCategories = await resolveServiceCategories(profile.serviceCategories);

    return {
      type: "provider" as const,
      id: profile.id,
      phoneNumber: profile.phoneNumber,
      fullName: profile.fullName,
      gender: profile.gender || null,
      email: profile.email || null,
      profilePhotoUrl: await profilePhotoUrl(profile.profilePhotoUrl),
      status: profile.status,
      referralCode: profile.referralCode,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      kycVerified: profile.kycVerified,
      kycStatus: profile.kycStatus,
      kycRejectionReason: profile.kycRejectionReason,
      availabilityStatus: profile.availabilityStatus,
      serviceCategories,
      stats,
    };
  },

  async uploadProfilePhoto(
    auth: { type: "customer" | "provider"; id: string },
    file: { filename: string; mimetype: string; buffer: Buffer },
  ) {
    const upload = normalizeImageUpload(file);
    const extension = extensionFromFilename(upload.filename);
    validateFileUpload(upload.mimetype, extension, upload.buffer.length, PROFILE_PHOTO_UPLOAD);

    const fileId = privateS3.newFileId();
    const s3Key = profilePhotoObjectKey(auth.type, auth.id, fileId, extension);

    let previousKey: string | null = null;
    if (auth.type === "customer") {
      const user = await userRepository.findById(auth.id);
      if (!user) throw new Error("USER_NOT_FOUND");
      previousKey = user.profileImageUrl;
      await privateS3.upload(s3Key, upload.buffer, upload.mimetype);
      await userRepository.updateProfileImageUrl(auth.id, s3Key);
    } else {
      const provider = await serviceProviderRepository.findById(auth.id);
      if (!provider) throw new Error("PROVIDER_NOT_FOUND");
      previousKey = provider.profilePhotoUrl;
      await privateS3.upload(s3Key, upload.buffer, upload.mimetype);
      await serviceProviderRepository.updateProfilePhotoUrl(auth.id, s3Key);
    }

    if (previousKey && isStoredS3Key(previousKey) && previousKey !== s3Key) {
      await privateS3.delete(previousKey).catch(() => undefined);
    }

    return { profilePhotoUrl: await privateS3.presignedGetUrl(s3Key) };
  },

  async updateFcmToken(
    auth: { type: "customer" | "provider"; id: string },
    fcmToken: string | null,
  ) {
    const normalized =
      fcmToken == null ? null : fcmToken.trim() || null;

    if (auth.type === "customer") {
      const user = await userRepository.findById(auth.id);
      if (!user) throw new Error("USER_NOT_FOUND");
      await userRepository.updateFcmToken(auth.id, normalized);
    } else {
      const provider = await serviceProviderRepository.findById(auth.id);
      if (!provider) throw new Error("PROVIDER_NOT_FOUND");
      await serviceProviderRepository.updateFcmToken(auth.id, normalized);
    }

    return { ok: true as const, fcmToken: normalized };
  },
};
