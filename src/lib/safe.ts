/**
 * Server components render against a live database. When Postgres or an
 * integration is unreachable we want a readable panel, not a stack trace, so
 * loaders are wrapped and the failure is returned as data.
 */
export async function safeLoad<T>(loader: () => Promise<T>): Promise<
  { ok: true; data: T } | { ok: false; error: string }
> {
  try {
    return { ok: true, data: await loader() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
