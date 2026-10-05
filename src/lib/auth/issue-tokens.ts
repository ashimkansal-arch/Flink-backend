import { randomUUID } from "node:crypto";
import { signAccessToken, signRefreshToken, verifyRefreshToken, type AccessTokenPayload, type ActorType } from "./jwt";
import { refreshTokenStore } from "./refresh-token-store";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Shared by all three auth services — issuing a token pair means: sign both tokens, and store
// the refresh token's jti so it can be verified (and revoked) later. New login overwrites any
// previously stored jti for this actor (single active session, per the confirmed P0 decision).
export async function issueTokenPair(actorType: ActorType, actorId: string, accessPayload: AccessTokenPayload): Promise<TokenPair> {
  const accessToken = signAccessToken(accessPayload);
  const jti = randomUUID();
  const refreshToken = signRefreshToken({ sub: actorId, type: actorType, jti });
  await refreshTokenStore.set(actorType, actorId, jti);
  return { accessToken, refreshToken };
}

// Verifies the refresh token's signature/expiry, confirms it's still the actor's *current*
// session (not a stale/revoked one), then issues a fresh pair. `buildAccessPayload` re-derives
// the access payload from the DB rather than trusting anything from the old token, so e.g. an
// admin's role rename is picked up on refresh, not just on next login.
export async function rotateTokenPair(
  actorType: ActorType,
  refreshToken: string,
  buildAccessPayload: (actorId: string) => Promise<AccessTokenPayload>,
): Promise<TokenPair> {
  const payload = verifyRefreshToken(refreshToken);
  if (payload.type !== actorType) {
    throw new Error("REFRESH_TOKEN_TYPE_MISMATCH");
  }

  const isCurrent = await refreshTokenStore.verify(actorType, payload.sub, payload.jti);
  if (!isCurrent) {
    throw new Error("REFRESH_TOKEN_REVOKED");
  }

  const accessPayload = await buildAccessPayload(payload.sub);
  return issueTokenPair(actorType, payload.sub, accessPayload);
}
