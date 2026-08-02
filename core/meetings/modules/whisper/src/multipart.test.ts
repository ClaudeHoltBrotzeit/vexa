/**
 * Regression gate: the multipart body must name array-typed OpenAI parameters with their
 * brackets. `timestamp_granularities` (bare) is accepted by permissive backends but REJECTED
 * by validating ones — Groq answers HTTP 400 'unknown param' for every chunk, which fails
 * silently in the worst way: recording uploads keep succeeding while the transcript stays
 * empty. Captures the body via a fetch stub and asserts on the wire format.
 * Run: npm test (chained)  or  npx tsx src/multipart.test.ts
 */
import { TranscriptionClient } from './index.js';

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${cond ? '' : '  — ' + detail}`);
  if (!cond) failed++;
};

const realFetch = globalThis.fetch;
/** Capture the request body the client actually puts on the wire. */
function captureFetch(): () => string {
  let body = '';
  (globalThis as any).fetch = async (_url: string, init: any) => {
    body = Buffer.isBuffer(init?.body) ? init.body.toString('utf8') : String(init?.body ?? '');
    return new Response(JSON.stringify({ text: 'ok', segments: [] }), { status: 200 });
  };
  return () => body;
}

async function run() {
  console.log('multipart wire format');
  const getBody = captureFetch();
  const client = new TranscriptionClient({
    serviceUrl: 'http://stub.invalid',
    model: 'whisper-large-v3-turbo',
  } as any);

  try {
    await (client as any).transcribe(Buffer.alloc(3200), { language: 'de' });
  } catch {
    // A stubbed backend may not satisfy the full response contract; the body is the subject here.
  }

  const body = getBody();
  check('sends timestamp_granularities WITH brackets',
        body.includes('name="timestamp_granularities[]"'),
        'validating backends (Groq) 400 the bare name');
  check('does not send the bare name',
        !/name="timestamp_granularities"/.test(body),
        'bare name found in body');
  check('carries the configured model, not a hardcoded default',
        body.includes('whisper-large-v3-turbo'),
        'model part missing or wrong');

  globalThis.fetch = realFetch;
  console.log(failed === 0 ? '\nPASS' : `\nFAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
