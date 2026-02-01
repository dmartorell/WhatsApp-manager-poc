import 'dotenv/config';

export const config = {
  waPhoneNumberId: process.env.WA_PHONE_NUMBER_ID!,
  waAccessToken: process.env.WA_ACCESS_TOKEN!,
  waVerifyToken: process.env.WA_VERIFY_TOKEN!,
  port: parseInt(process.env.PORT || '3000'),
};

// Validar que existen las variables requeridas
const required = ['waPhoneNumberId', 'waAccessToken', 'waVerifyToken'] as const;
for (const key of required) {
  if (!config[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}
