import { z } from 'zod';

/**
 * Runtime environment contract. Parsed lazily so that `next build` and unit
 * tests do not require live integration credentials, while any code path that
 * actually talks to Meta / MDM / Postgres fails loudly with a precise message.
 */
const serverSchema = z.object({
  META_ACCESS_TOKEN: z.string().min(1),
  META_AD_ACCOUNT_ID: z.string().regex(/^act_\d+$/, 'META_AD_ACCOUNT_ID must look like act_1234567890'),
  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_API_VERSION: z.string().default('v21.0'),

  SHOPIFY_WEBHOOK_SECRET: z.string().min(1),

  MDM_API_BASE_URL: z.string().url(),
  MDM_API_KEY: z.string().min(1),

  DATABASE_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(16, 'NEXTAUTH_SECRET must be at least 16 characters'),

  CRON_SECRET: z.string().optional(),
  DEFAULT_CURRENCY: z.string().default('MAD'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

type Section = 'meta' | 'shopify' | 'mdm' | 'auth';

const SECTION_KEYS: Record<Section, (keyof ServerEnv)[]> = {
  meta: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_APP_ID', 'META_APP_SECRET', 'META_API_VERSION'],
  shopify: ['SHOPIFY_WEBHOOK_SECRET'],
  mdm: ['MDM_API_BASE_URL', 'MDM_API_KEY'],
  auth: ['NEXTAUTH_SECRET'],
};

export class MissingEnvError extends Error {
  constructor(public readonly keys: string[]) {
    super(`Missing or invalid environment variables: ${keys.join(', ')}`);
    this.name = 'MissingEnvError';
  }
}

/** Validate only the slice of env a given integration needs. */
export function requireEnv<K extends keyof ServerEnv>(keys: readonly K[]): Pick<ServerEnv, K> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of keys) shape[key] = serverSchema.shape[key];
  const result = z.object(shape).safeParse(process.env);
  if (!result.success) {
    throw new MissingEnvError(result.error.issues.map((i) => i.path.join('.')));
  }
  return result.data as Pick<ServerEnv, K>;
}

export function requireSection(section: Section) {
  return requireEnv(SECTION_KEYS[section] as (keyof ServerEnv)[]);
}

/** Non-throwing health probe used by the integrations status panel. */
export function envSectionStatus(section: Section): { configured: boolean; missing: string[] } {
  try {
    requireSection(section);
    return { configured: true, missing: [] };
  } catch (error) {
    if (error instanceof MissingEnvError) return { configured: false, missing: error.keys };
    throw error;
  }
}

export const currency = () => process.env.DEFAULT_CURRENCY ?? 'MAD';
