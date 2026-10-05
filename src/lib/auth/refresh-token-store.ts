import { queueRedis } from "../redis-queue-client";
import { refreshTokenKey } from "../redis-keys";
import { REFRESH_TOKEN_TTL_SECONDS, type ActorType } from "./jwt";

// Single active refresh token per actor: a new login overwrites the stored jti, invalidating any
// previously issued refresh token for that actor. Lives on queueRedis (noeviction) — losing this
// unexpectedly means an unexpected logout, not an acceptable cache miss.
export const refreshTokenStore = {
  async set(actorType: ActorType, actorId: string, jti: string): Promise<void> {
    await queueRedis.set(refreshTokenKey(actorType, actorId), jti, "EX", REFRESH_TOKEN_TTL_SECONDS);
  },

  async verify(actorType: ActorType, actorId: string, jti: string): Promise<boolean> {
    const stored = await queueRedis.get(refreshTokenKey(actorType, actorId));
    return stored === jti;
  },

  async revoke(actorType: ActorType, actorId: string): Promise<void> {
    await queueRedis.del(refreshTokenKey(actorType, actorId));
  },
};
