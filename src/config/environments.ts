export type Environment = "local" | "test" | "staging" | "production";

interface EnvironmentDefaults {
  logLevel: "debug" | "info" | "warn" | "error" | "silent";
  rateLimit: { max: number; timeWindow: string };
}

// Settings that differ by environment but aren't secrets — safe to hardcode and commit.
export const environmentDefaults: Record<Environment, EnvironmentDefaults> = {
  local: {
    logLevel: "debug",
    rateLimit: { max: 1000, timeWindow: "1 minute" },
  },
  test: {
    logLevel: "silent",
    rateLimit: { max: 10000, timeWindow: "1 minute" },
  },
  staging: {
    logLevel: "info",
    rateLimit: { max: 300, timeWindow: "1 minute" },
  },
  production: {
    logLevel: "warn",
    rateLimit: { max: 100, timeWindow: "1 minute" },
  },
};
