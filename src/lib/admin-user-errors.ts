const ADMIN_USER_ERRORS: Record<string, 400 | 401 | 404 | 409> = {
  ADMIN_NOT_FOUND: 404,
  ROLE_NOT_FOUND: 404,
  CATEGORY_NOT_FOUND: 404,
  ASSIGNED_ADMIN_NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  PHONE_TAKEN: 409,
  CANNOT_DELETE_SELF: 409,
  NO_ROLE_PEER: 409,
  UNKNOWN_ROLE: 400,
  UNKNOWN_PERMISSION: 400,
  ROLE_REQUIRED: 400,
  ROLE_NOT_ALLOWED: 400,
  TEAM_TRANSFER_REQUIRED: 400,
  TRANSFER_TARGET_INVALID: 400,
  INVALID_CREDENTIALS: 401,
};

export function mapAdminUserError(message: string): { status: 400 | 401 | 404 | 409; error: string } | null {
  const status = ADMIN_USER_ERRORS[message];
  return status ? { status, error: message } : null;
}
