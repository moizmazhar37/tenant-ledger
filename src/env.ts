import { z } from 'zod';

const serverEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  WEBHOOK_SECRET: z.string().min(16, 'WEBHOOK_SECRET must be at least 16 characters'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Validated lazily so `next build` does not need runtime secrets, but the first
 * request in a misconfigured environment fails loudly instead of limping along.
 */
export function serverEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  });
  return cached;
}
