import { userRepository } from "../../repositories/user-repository";
import { serviceProviderRepository } from "../../repositories/service-provider-repository";
import { adminUserRepository } from "../../repositories/admin-user-repository";
import { supervisorRepository } from "../../repositories/supervisor-repository";

// Status rules shared by requireAuth (every authenticated request) and login/refresh flows.
// Keep codes stable — route handlers and clients key off these strings.

export const PROVIDER_ACCOUNT_ERROR_CODES = new Set([
  "ACCOUNT_INACTIVE",
  "ACCOUNT_SUSPENDED",
  "ACCOUNT_DELETED",
]);

export function assertCustomerStatus(status: string): void {
  if (status === "deleted") throw new Error("ACCOUNT_DELETED");
  if (status === "blocked") throw new Error("ACCOUNT_BLOCKED");
}

export function assertProviderStatus(status: string): void {
  if (status === "deleted") throw new Error("ACCOUNT_DELETED");
  if (status === "suspended") throw new Error("ACCOUNT_SUSPENDED");
}

export function assertProviderCanAuthenticate(status: string): void {
  assertProviderStatus(status);
  if (status === "inactive") throw new Error("ACCOUNT_INACTIVE");
}

export function assertAdminStatus(status: string): void {
  if (status !== "active") throw new Error("ACCOUNT_INACTIVE");
}

export async function assertCustomerActiveById(userId: string): Promise<void> {
  const user = await userRepository.findById(userId);
  if (!user) throw new Error("USER_NOT_FOUND");
  assertCustomerStatus(user.status);
}

export async function assertProviderActiveById(providerId: string): Promise<void> {
  const provider = await serviceProviderRepository.findById(providerId);
  if (!provider) throw new Error("PROVIDER_NOT_FOUND");
  assertProviderStatus(provider.status);
}

export async function assertAdminActiveById(adminId: string): Promise<void> {
  const admin = await adminUserRepository.findById(adminId);
  if (!admin) throw new Error("ADMIN_NOT_FOUND");
  assertAdminStatus(admin.status);
}

export async function assertSupervisorActiveById(supervisorId: string): Promise<void> {
  const supervisor = await supervisorRepository.findById(supervisorId);
  if (!supervisor) throw new Error("SUPERVISOR_NOT_FOUND");
  if (supervisor.status !== "active") throw new Error("ACCOUNT_INACTIVE");
}
