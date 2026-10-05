import type { FastifyError } from "fastify";

type ValidationIssue = {
  instancePath?: string;
  message?: string;
  origin?: string;
};

function fieldLabel(issue: ValidationIssue) {
  const path = issue.instancePath?.replace(/^\//, "").replace(/\//g, ".");
  if (path) return path;
  if (issue.origin && issue.origin !== "body") return issue.origin;
  return "";
}

function friendlyIssue(raw: string, field: string) {
  if (/expected object, received null/i.test(raw)) {
    return "Request body must be a JSON object, or omitted";
  }
  if (/received undefined|required/i.test(raw) && !field) {
    return "Request body is required";
  }
  const text = raw.replace(/^Invalid input:\s*/i, "");
  return field ? `${field}: ${text}` : text;
}

/** Client-safe text for Fastify validation / rate-limit errors (not internal 500s). */
export function publicRequestError(err: FastifyError): string {
  if (err.statusCode === 429) return "Too many requests. Please try again shortly.";

  const issues = err.validation;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .map((issue) => {
        const item = issue as ValidationIssue;
        return friendlyIssue(item.message ?? "Invalid value", fieldLabel(item));
      })
      .join("; ");
  }

  const message = err.message?.replace(/^(body|querystring|params|headers)\/\s*/i, "").trim();
  return friendlyIssue(message || "Invalid request", "");
}
