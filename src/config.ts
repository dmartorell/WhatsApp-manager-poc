import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  waPhoneNumberId: requireEnv('WA_PHONE_NUMBER_ID'),
  waAccessToken: requireEnv('WA_ACCESS_TOKEN'),
  waVerifyToken: requireEnv('WA_VERIFY_TOKEN'),
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
  baseEmail: requireEnv('BASE_EMAIL'),
  port: parseInt(process.env.PORT || '3000'),
};
