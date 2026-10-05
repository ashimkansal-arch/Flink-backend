import { serviceProviderRepository, type ProviderDeviceInfo } from "../repositories/service-provider-repository";
import { issueTokenPair, rotateTokenPair, type TokenPair } from "../lib/auth/issue-tokens";
import { refreshTokenStore } from "../lib/auth/refresh-token-store";
import { assertProviderCanAuthenticate } from "../lib/auth/actor-status";
import { parseProviderDeviceInfo } from "../lib/provider-device";

export class ProviderDeviceMismatchError extends Error {
  constructor(public readonly registeredDeviceName: string) {
    super("DEVICE_NOT_AUTHORIZED");
  }
}

export const providerAuthService = {
  async login(phoneNumber: string, device: ProviderDeviceInfo): Promise<TokenPair> {
    const provider = await serviceProviderRepository.findByPhone(phoneNumber.trim());
    if (!provider) throw new Error("PROVIDER_NOT_FOUND");

    assertProviderCanAuthenticate(provider.status);

    const incoming: ProviderDeviceInfo = {
      deviceId: device.deviceId.trim(),
      deviceName: device.deviceName.trim(),
    };
    const registered = parseProviderDeviceInfo(provider.deviceInfo);

    if (registered) {
      if (registered.deviceId !== incoming.deviceId) {
        throw new ProviderDeviceMismatchError(registered.deviceName);
      }
      if (registered.deviceName !== incoming.deviceName) {
        await serviceProviderRepository.updateDeviceInfo(provider.id, incoming);
      }
    } else {
      await serviceProviderRepository.updateDeviceInfo(provider.id, incoming);
    }

    return issueTokenPair("provider", provider.id, {
      sub: provider.id,
      type: "provider",
      phone: provider.phoneNumber,
    });
  },

  async refresh(refreshToken: string): Promise<TokenPair> {
    return rotateTokenPair("provider", refreshToken, async (providerId) => {
      const provider = await serviceProviderRepository.findById(providerId);
      if (!provider) throw new Error("PROVIDER_NOT_FOUND");
      assertProviderCanAuthenticate(provider.status);
      return { sub: provider.id, type: "provider", phone: provider.phoneNumber };
    });
  },

  async logout(providerId: string): Promise<void> {
    await refreshTokenStore.revoke("provider", providerId);
  },

  async deleteAccount(providerId: string): Promise<void> {
    await serviceProviderRepository.softDelete(providerId);
    await refreshTokenStore.revoke("provider", providerId);
  },
};
