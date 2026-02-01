import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string = ''): string {
  return process.env[name] || defaultValue;
}

export const config = {
  waPhoneNumberId: requireEnv('WA_PHONE_NUMBER_ID'),
  waAccessToken: requireEnv('WA_ACCESS_TOKEN'),
  waVerifyToken: requireEnv('WA_VERIFY_TOKEN'),
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
  baseEmail: requireEnv('BASE_EMAIL'),
  port: parseInt(process.env.PORT || '3000'),

  // SMTP config (optional for Phase 3)
  smtpHost: optionalEnv('SMTP_HOST'),
  smtpPort: parseInt(optionalEnv('SMTP_PORT', '587')),
  smtpUser: optionalEnv('SMTP_USER'),
  smtpPassword: optionalEnv('SMTP_PASSWORD'),
  emailFrom: optionalEnv('EMAIL_FROM'),
};
