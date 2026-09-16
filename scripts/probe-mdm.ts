import { config } from 'dotenv';
import {
  AUTH_SCHEMES,
  DEFAULT_ORDERS_PATH,
  ORDERS_PATH_CANDIDATES,
  probeOrdersPath,
  buildSearchBody,
  mapMdmOrder,
  normalizeMdmStatus,
  probeAuthScheme,
  rawSearch,
  resolveMdmUrl,
  unwrapRows,
  type AuthScheme,
} from '../src/lib/mdm';

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

  console.log(`Host     : ${baseUrl}`);
  console.log(`API key  : ${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (${apiKey.length} chars)\n`);

  // Phase 1: find the list endpoint. MDM documents bearer auth, so hold the
  // credential constant and vary only the path.
  console.log('Looking for the order-list endpoint (POST, bearer auth):');
  const pathResults = [];
  for (const candidate of ORDERS_PATH_CANDIDATES) {
    process.stdout.write(`  ${candidate.padEnd(26)} `);
    const result = await probeOrdersPath(candidate, 'bearer');
    pathResults.push(result);
    console.log(`${result.ok ? 'OK  ' : String(result.status ?? 'ERR').padEnd(4)} ${result.detail}`);
  }

  const workingPath = pathResults.find((result) => result.ok);
  if (workingPath) {
    console.log(`\nWorking endpoint: POST ${resolveMdmUrl(baseUrl, workingPath.path)}`);
    if (workingPath.path !== DEFAULT_ORDERS_PATH) {
      console.log(`Add to your .env:\n\n    MDM_ORDERS_PATH="${workingPath.path}"\n`);
    }
    if (process.argv.includes('--dump')) await dumpSample('bearer', workingPath.path);
    else console.log('\nRun with --dump to print one raw order and confirm the field mapping.');
    return;
  }

  // A 404 everywhere means the path is wrong; a 401 everywhere points at the
  // credential, so only then is it worth varying the auth scheme.
  const allNotFound = pathResults.every((result) => result.status === 404);
  if (allNotFound) {
    console.log('\nEvery candidate path returned 404, so none of them is the list endpoint.');
    console.log('In the MDM API reference, open Orders > "Get Orders" and read the URL');
    console.log('shown at the top, then set MDM_ORDERS_PATH to its path.');
    process.exitCode = 1;
    return;
  }

  console.log('\nNo path was accepted with bearer auth. Trying other credential shapes');
  console.log(`against ${DEFAULT_ORDERS_PATH}:\n`);

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
    const scheme = working[0].scheme;
    console.log(`Working scheme: ${scheme}`);
    console.log(`Add this to your .env:\n\n    MDM_AUTH_SCHEME="${scheme}"\n`);
    if (process.argv.includes('--dump')) await dumpSample(scheme, DEFAULT_ORDERS_PATH);
    else console.log('Run with --dump to print one raw order, to confirm field and status mapping.');
    return;
  }

  const statuses = new Set(results.map((result) => result.status));
  if (statuses.size === 1 && statuses.has(401)) {
    console.log('Every scheme returned 401 on every path. MDM documents bearer auth, so');
    console.log('the key itself is most likely invalid, expired, or not enabled for this');
    console.log('endpoint - regenerate it in the MDM dashboard and try again.');
  } else {
    console.log('No scheme was accepted. The response bodies above usually name the');
    console.log('expected credential; send them over and the client can be matched to it.');
  }
  process.exitCode = 1;
}

/**
 * Prints one real order exactly as MDM returned it, next to how this client
 * interpreted it. That is what confirms the field names and status vocabulary
 * without needing the API documentation.
 */
async function dumpSample(scheme: AuthScheme, path: string) {
  const payload = await rawSearch(buildSearchBody({ perPage: 1 }, 1), scheme, path);
  const rows = unwrapRows(payload);

  console.log('--- envelope keys ---');
  console.log(payload && typeof payload === 'object' ? Object.keys(payload).join(', ') : typeof payload);

  if (rows.length === 0) {
    console.log('\nNo rows came back. Widen the date range, or the account has no orders.');
    console.log('Raw payload:\n' + JSON.stringify(payload, null, 2).slice(0, 1500));
    return;
  }

  console.log('\n--- raw order (redact the phone before sharing) ---');
  console.log(JSON.stringify(rows[0], null, 2).slice(0, 2000));

  const mapped = mapMdmOrder(rows[0]);
  console.log('\n--- as this client reads it ---');
  console.log(JSON.stringify(mapped, null, 2));
  console.log(`\nstatus "${mapped.status}" maps to ${normalizeMdmStatus(mapped.status)}`);
  if (normalizeMdmStatus(mapped.status) === 'NEW' && mapped.status.toUpperCase() !== 'NEW') {
    console.log('!! That status is unrecognised and fell back to NEW. Send it over so');
    console.log('   STATUS_MAP in src/lib/mdm.ts can be extended.');
  }
  if (!mapped.id) console.log('!! No order id was found - the id field name differs from those handled.');
  if (!mapped.reference) console.log('!! No reference found - orders cannot be matched back to Shopify.');
}

main().catch((error) => {
  console.error('Probe failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
