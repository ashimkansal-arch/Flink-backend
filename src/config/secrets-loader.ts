import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

// Fetches a JSON secret ({"JWT_ACCESS_SECRET": "...", "STRIPE_SECRET_KEY": "...", ...}) from
// AWS Secrets Manager and merges it into process.env, ahead of schema validation. No-op unless
// SECRETS_PROVIDER=aws-secrets-manager, so local dev (.env) and platforms that inject env vars
// directly (Doppler, GCP Secret Manager via workload identity, etc.) are unaffected.
export async function loadSecretsIntoProcessEnv(): Promise<void> {
  if (process.env.SECRETS_PROVIDER !== "aws-secrets-manager") {
    return;
  }

  const secretId = process.env.AWS_SECRETS_MANAGER_SECRET_ID;
  if (!secretId) {
    throw new Error("AWS_SECRETS_MANAGER_SECRET_ID must be set when SECRETS_PROVIDER=aws-secrets-manager");
  }

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

  if (!response.SecretString) {
    throw new Error(`Secret "${secretId}" has no SecretString payload`);
  }

  let secrets: Record<string, string>;
  try {
    secrets = JSON.parse(response.SecretString);
  } catch {
    throw new Error(`Secret "${secretId}" is not valid JSON`);
  }

  for (const [key, value] of Object.entries(secrets)) {
    // Values already set in the environment (e.g. PORT set by the platform) take precedence.
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
