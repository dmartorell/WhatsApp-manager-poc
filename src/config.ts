import 'dotenv/config';
import { DEFAULT_SMTP_PORT, DEFAULT_SERVER_PORT } from './constants.js';

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

function parseIntSafe(value: string, defaultValue: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export const config = {
  waPhoneNumberId: requireEnv('WA_PHONE_NUMBER_ID'),
  waAccessToken: requireEnv('WA_ACCESS_TOKEN'),
  waVerifyToken: requireEnv('WA_VERIFY_TOKEN'),
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
  baseEmail: requireEnv('BASE_EMAIL'),
  port: parseIntSafe(process.env.PORT || '', DEFAULT_SERVER_PORT),

  // SMTP config (optional for Phase 3)
  smtpHost: optionalEnv('SMTP_HOST'),
  smtpPort: parseIntSafe(optionalEnv('SMTP_PORT'), DEFAULT_SMTP_PORT),
  smtpUser: optionalEnv('SMTP_USER'),
  smtpPassword: optionalEnv('SMTP_PASSWORD'),
  emailFrom: optionalEnv('EMAIL_FROM'),
};
