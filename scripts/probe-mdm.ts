import { config } from 'dotenv';
import { AUTH_SCHEMES, ORDERS_SEARCH_PATH, probeAuthScheme, resolveMdmUrl } from '../src/lib/mdm';

config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

/**
 * Determines which authentication scheme MDM Express accepts.
 *
 * A 401 says the key was rejected, not which credential shape was expected.
 * Rather than guess one per deploy, this tries each candidate against the live
 * search endpoint and reports what came back.
 */
async function main() {
  const baseUrl = process.env.MDM_API_BASE_URL;
  const apiKey = process.env.MDM_API_KEY;

  if (!baseUrl || !apiKey) {
    console.error('MDM_API_BASE_URL and MDM_API_KEY must be set in .env or .env.local.');
    process.exit(1);
  }

  console.log(`Endpoint : POST ${resolveMdmUrl(baseUrl, ORDERS_SEARCH_PATH)}`);
  console.log(`API key  : ${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (${apiKey.length} chars)\n`);

  const results = [];
  for (const scheme of AUTH_SCHEMES) {
    process.stdout.write(`  ${scheme.padEnd(16)} `);
    const result = await probeAuthScheme(scheme);
    results.push(result);
    console.log(`${result.ok ? 'OK  ' : String(result.status ?? 'ERR').padEnd(4)} ${result.detail}`);
  }

  const working = results.filter((result) => result.ok);
  console.log();

  if (working.length > 0) {
    console.log(`Working scheme: ${working[0].scheme}`);
    console.log(`Add this to your .env:\n\n    MDM_AUTH_SCHEME="${working[0].scheme}"\n`);
    return;
  }

  const statuses = new Set(results.map((result) => result.status));
  if (statuses.size === 1 && statuses.has(401)) {
    console.log('Every scheme returned 401. The key itself is most likely invalid,');
    console.log('expired, or not enabled for this endpoint - check it in the MDM dashboard.');
  } else {
    console.log('No scheme was accepted. The response bodies above usually name the');
    console.log('expected credential; send them over and the client can be matched to it.');
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('Probe failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
