import { existsSync, readFileSync, statSync } from "node:fs";
import jwt from "jsonwebtoken";
import { renderNotification } from "./notification-templates";

type FcmResult = { ok: true; skipped?: boolean } | { ok: false; error: string };

type ServiceAccount = {
  project_id: string;
  private_key: string;
  client_email: string;
};

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedAccess: { token: string; expiresAtMs: number; projectId: string } | null = null;
let cachedAccount: ServiceAccount | null | undefined;

/**
 * Sends an FCM HTTP v1 notification when `FCM_SERVICE_ACCOUNT_PATH` points at a
 * Firebase service-account JSON. Without it, push is skipped.
 */
export async function sendFcmPush(input: {
  token: string;
  templateKey: string;
  payload?: Record<string, unknown>;
}): Promise<FcmResult> {
  try {
    const account = loadServiceAccount();
    if (!account) {
      return { ok: true, skipped: true };
    }

    const content = renderNotification(input.templateKey, input.payload);
    const data: Record<string, string> = {
      templateKey: input.templateKey,
    };
    if (input.payload) {
      for (const [key, value] of Object.entries(input.payload)) {
        if (value == null) continue;
        data[key] = typeof value === "string" ? value : JSON.stringify(value);
      }
    }

    const accessToken = await getAccessToken(account);
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: input.token,
            notification: {
              title: content.title,
              body: content.body,
            },
            data,
            android: { priority: "HIGH" },
            apns: { headers: { "apns-priority": "10" } },
          },
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `FCM_HTTP_${res.status}:${text.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "FCM_NETWORK_ERROR",
    };
  }
}

export function logFcmStatus() {
  const account = loadServiceAccount();
  if (account) {
    console.log(`[fcm] ready project=${account.project_id}`);
    return;
  }
  const path = process.env.FCM_SERVICE_ACCOUNT_PATH?.trim();
  console.warn(`[fcm] push disabled${path ? ` path=${path}` : " (FCM_SERVICE_ACCOUNT_PATH unset)"}`);
}

function loadServiceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;

  const path = process.env.FCM_SERVICE_ACCOUNT_PATH?.trim();
  if (!path) {
    cachedAccount = null;
    return null;
  }

  try {
    if (!existsSync(path)) {
      console.error(`[fcm] service account file not found: ${path}`);
      cachedAccount = null;
      return null;
    }
    if (statSync(path).isDirectory()) {
      console.error(
        `[fcm] ${path} is a directory. Docker created it because the JSON was missing on the host. Remove that folder and put the real JSON file there.`,
      );
      cachedAccount = null;
      return null;
    }
    cachedAccount = parseServiceAccount(readFileSync(path, "utf8"));
    return cachedAccount;
  } catch (err) {
    console.error(`[fcm] failed to read ${path}`, err instanceof Error ? err.message : err);
    cachedAccount = null;
    return null;
  }
}

function parseServiceAccount(raw: string): ServiceAccount {
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  const projectId = parsed.project_id?.trim();
  const clientEmail = parsed.client_email?.trim();
  const privateKey = parsed.private_key?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FCM_SERVICE_ACCOUNT_INVALID");
  }
  return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedAccess && cachedAccess.projectId === account.project_id && cachedAccess.expiresAtMs > Date.now() + 60_000) {
    return cachedAccess.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: account.client_email,
      sub: account.client_email,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
      scope: FCM_SCOPE,
    },
    account.private_key,
    { algorithm: "RS256" },
  );

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FCM_OAUTH_${res.status}:${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("FCM_OAUTH_NO_TOKEN");

  cachedAccess = {
    token: body.access_token,
    projectId: account.project_id,
    expiresAtMs: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedAccess.token;
}
