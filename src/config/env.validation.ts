const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'OTP_SECRET'] as const;

export function validateEnv(config: Record<string, unknown>) {
  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  return config;
}
