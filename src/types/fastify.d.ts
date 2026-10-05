import "fastify";

type AuthContext =
  | { type: "customer" | "provider"; id: string; phone: string }
  | { type: "admin"; id: string; role: string }
  | { type: "supervisor"; id: string };

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    // Raw bytes of the request body, captured alongside the parsed JSON by the content-type
    // parser in app.ts. Stripe webhook signature verification needs the exact bytes it signed —
    // re-serializing the parsed JSON would produce a different (differently-ordered/whitespaced)
    // byte string and fail verification.
    rawBody?: Buffer;
  }
}
