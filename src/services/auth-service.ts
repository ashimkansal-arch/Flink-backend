import { adminUserRepository } from "../repositories/admin-user-repository";
import { supervisorRepository } from "../repositories/supervisor-repository";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "../lib/auth/password";
import { issueTokenPair, rotateTokenPair, type TokenPair } from "../lib/auth/issue-tokens";
import { verifyRefreshToken } from "../lib/auth/jwt";
import { refreshTokenStore } from "../lib/auth/refresh-token-store";
import { getPermissionsForAdmin } from "../lib/auth/permissions";
import { categoryForRole, roleDisplayLabel } from "../lib/auth/crm-roles";
import { sendTeamMemberPasswordResetEmail } from "../lib/mailer";
import { adminUserService } from "./admin-user-service";
import { adminModuleService } from "./admin-module-service";
import { managedTeamRolesForRole } from "../lib/team-member-role-modules";

export const CONTACT_ADMIN_PASSWORD_RESET_MESSAGE =
  "Please contact your administrator to reset your password.";

export type AuthLoginResult = TokenPair & {
  passwordResetRequired: boolean;
  type: "admin" | "supervisor";
  role: string | null;
};

export const authService = {
  async login(email: string, password: string): Promise<AuthLoginResult> {
    const normalized = email.trim().toLowerCase();

    const admin = await adminUserRepository.findByEmail(normalized);
    if (admin) {
      if (admin.status !== "active" || !admin.passwordHash) throw new Error("INVALID_CREDENTIALS");
      if (!(await verifyPassword(password, admin.passwordHash))) throw new Error("INVALID_CREDENTIALS");

      await adminUserRepository.updateLastLogin(admin.id);
      const tokens = await issueTokenPair("admin", admin.id, {
        sub: admin.id,
        type: "admin",
        role: admin.role.roleName,
      });
      return {
        ...tokens,
        passwordResetRequired: admin.passwordResetRequired,
        type: "admin",
        role: admin.role.roleName,
      };
    }

    const supervisor = await supervisorRepository.findByEmail(normalized);
    if (!supervisor || supervisor.status !== "active") throw new Error("INVALID_CREDENTIALS");
    if (!(await verifyPassword(password, supervisor.passwordHash))) throw new Error("INVALID_CREDENTIALS");

    const tokens = await issueTokenPair("supervisor", supervisor.id, {
      sub: supervisor.id,
      type: "supervisor",
    });
    return {
      ...tokens,
      passwordResetRequired: supervisor.passwordResetRequired,
      type: "supervisor",
      role: null,
    };
  },

  async forgotPassword(email: string): Promise<{ ok: true; passwordResetRequired: true }> {
    const normalized = email.trim().toLowerCase();
    const admin = await adminUserRepository.findByEmail(normalized);

    if (admin?.role.roleName === "super_admin" && admin.status === "active") {
      const temporaryPassword = generateTemporaryPassword();
      await adminUserRepository.update(admin.id, {
        passwordHash: await hashPassword(temporaryPassword),
        passwordResetRequired: true,
      });
      await refreshTokenStore.revoke("admin", admin.id);
      await sendTeamMemberPasswordResetEmail({
        to: admin.email,
        fullName: admin.fullName ?? "there",
        temporaryPassword,
        roleLabel: roleDisplayLabel(admin.role.roleName),
      });
      return { ok: true, passwordResetRequired: true };
    }

    throw new Error("CONTACT_ADMIN");
  },

  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = verifyRefreshToken(refreshToken);
    if (payload.type === "admin") {
      return rotateTokenPair("admin", refreshToken, async (adminId) => {
        const admin = await adminUserRepository.findById(adminId);
        if (!admin || admin.status !== "active") throw new Error("ADMIN_NOT_FOUND_OR_INACTIVE");
        return { sub: admin.id, type: "admin", role: admin.role.roleName };
      });
    }
    if (payload.type === "supervisor") {
      return rotateTokenPair("supervisor", refreshToken, async (supervisorId) => {
        const supervisor = await supervisorRepository.findById(supervisorId);
        if (!supervisor || supervisor.status !== "active") throw new Error("ACCOUNT_INACTIVE");
        return { sub: supervisor.id, type: "supervisor" };
      });
    }
    throw new Error("INVALID_REFRESH_TOKEN");
  },

  async logout(type: "admin" | "supervisor", id: string): Promise<void> {
    await refreshTokenStore.revoke(type, id);
  },

  async me(type: "admin" | "supervisor", id: string, role?: string) {
    if (type === "admin") {
      const profile = await adminUserService.getById(id);
      const resolvedRole = role ?? profile.role;
      const permissions = await getPermissionsForAdmin(id, resolvedRole);
      const sidebar = await adminModuleService.sidebarForRole(resolvedRole);
      return {
        id,
        type: "admin" as const,
        role: resolvedRole,
        fullName: profile.fullName,
        email: profile.email,
        phoneNumber: profile.phoneNumber,
        passwordResetRequired: profile.passwordResetRequired,
        permissions,
        status: null,
        category: categoryForRole(resolvedRole),
        createdBy: null,
        isAdmin: profile.isAdmin,
        sidebar,
        managedTeamRoles: await managedTeamRolesForRole(resolvedRole),
      };
    }

    const supervisor = await supervisorRepository.findById(id);
    if (!supervisor) throw new Error("SUPERVISOR_NOT_FOUND");
    return {
      id: supervisor.id,
      type: "supervisor" as const,
      fullName: supervisor.fullName,
      email: supervisor.email,
      phoneNumber: supervisor.phoneNumber,
      status: supervisor.status,
      passwordResetRequired: supervisor.passwordResetRequired,
      category: supervisor.category,
      createdBy: supervisor.createdBy,
      role: null,
      permissions: [] as string[],
    };
  },

  async changePassword(
    type: "admin" | "supervisor",
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (type === "admin") {
      await adminUserService.changePassword(id, currentPassword, newPassword);
      return;
    }

    const supervisor = await supervisorRepository.findById(id);
    if (!supervisor) throw new Error("INVALID_CREDENTIALS");
    if (!(await verifyPassword(currentPassword, supervisor.passwordHash))) {
      throw new Error("INVALID_CREDENTIALS");
    }
    await supervisorRepository.update(id, {
      passwordHash: await hashPassword(newPassword),
      passwordResetRequired: false,
    });
  },
};
