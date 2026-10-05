import type { ProviderDeviceInfo } from "../repositories/service-provider-repository";

export function parseProviderDeviceInfo(value: unknown): ProviderDeviceInfo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.deviceId !== "string" || typeof row.deviceName !== "string") return null;
  const deviceId = row.deviceId.trim();
  const deviceName = row.deviceName.trim();
  if (!deviceId || !deviceName) return null;
  return { deviceId, deviceName };
}

export function deviceMismatchMessage(registeredDeviceName: string): string {
  return (
    `This device is not authorized for your account. Please contact your supervisor to reset your registered device, ` +
    `or sign in using your registered device: ${registeredDeviceName}.`
  );
}
