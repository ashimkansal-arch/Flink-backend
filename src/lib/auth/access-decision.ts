/**
 * Authorization decision stub (Unified Spec §6).
 * Full list filtering / booking mutation enforcement comes in a later pass.
 */
export type AccessDecision = "ALLOW" | "DENY" | "APPROVAL_REQUIRED";

export type EvaluateAccessInput = {
  hasPermission: boolean;
  resourceVisible: boolean;
  resourceInScope: boolean;
  approvalRequired: boolean;
};

export function evaluateAccess(input: EvaluateAccessInput): AccessDecision {
  if (!input.hasPermission) return "DENY";
  if (!input.resourceVisible) return "DENY";
  if (!input.resourceInScope) return "DENY";
  if (input.approvalRequired) return "APPROVAL_REQUIRED";
  return "ALLOW";
}
