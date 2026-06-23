import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Cross-spec endpoint-coverage recorder.
 *
 * Every request made through the `api()` wrapper (see ./http.ts) appends a
 * `METHOD path` line to a shared hits file. The coverage-guard spec
 * (test/zz-coverage.e2e-spec.ts) reads the file at the end of the run and
 * compares the set of exercised routes against the OpenAPI document, so adding
 * a new endpoint without a matching test fails the suite.
 *
 * Aggregation across spec files only works when Jest runs them in a single
 * worker — jest-e2e.json sets `maxWorkers: 1` for exactly this reason.
 */
export const HITS_FILE = path.join(os.tmpdir(), 'sloms-e2e-coverage-hits.txt');

/** Remove the hits file. Called from test/support/global-setup.js per run. */
export function resetHits(): void {
  try {
    fs.unlinkSync(HITS_FILE);
  } catch {
    /* not there yet — fine */
  }
}

/** Record one exercised route. `url` may include a query string; it is stripped. */
export function recordHit(method: string, url: string): void {
  const pathOnly = url.split('?')[0];
  fs.appendFileSync(HITS_FILE, `${method.toUpperCase()} ${pathOnly}\n`);
}

/** Load every recorded `METHOD path` hit (deduplicated). */
export function loadHits(): { method: string; path: string }[] {
  let raw = '';
  try {
    raw = fs.readFileSync(HITS_FILE, 'utf8');
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: { method: string; path: string }[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    const [method, ...rest] = trimmed.split(' ');
    out.push({ method, path: rest.join(' ') });
  }
  return out;
}
