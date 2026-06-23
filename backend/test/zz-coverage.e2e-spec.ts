import { createTestApp } from './support/app';
import { buildOperations, isCovered, Operation } from './support/openapi';
import { loadHits } from './support/coverage';

/**
 * Endpoint-coverage guard.
 *
 * Runs last (the "zz" filename sorts after every other spec) so it sees the
 * routes every other spec exercised — this only works under a single Jest
 * worker, which jest-e2e.json enforces with `maxWorkers: 1`.
 *
 * It builds the OpenAPI document (the full list of endpoints + parameters) and
 * checks each operation was hit at least once by the suite. By default it only
 * REPORTS gaps so a single-file run (`jest customers`) doesn't fail spuriously.
 * Set COVERAGE_GUARD=1 (CI does) to turn the gap into a hard failure.
 */
describe('API endpoint coverage', () => {
  let operations: Operation[];
  let uncovered: Operation[];

  beforeAll(async () => {
    const { app } = await createTestApp();
    try {
      operations = buildOperations(app);
    } finally {
      await app.close();
    }
    const hits = loadHits();
    uncovered = operations.filter((op) => !isCovered(op, hits));
  });

  it('discovers the documented endpoint surface', () => {
    expect(operations.length).toBeGreaterThan(0);
  });

  const enforced = process.env.COVERAGE_GUARD === '1';

  (enforced ? it : it.skip)(
    'exercises every documented endpoint at least once',
    () => {
      const missing = uncovered.map(
        (op) => `${op.method.toUpperCase()} ${op.template}`,
      );
      expect(missing).toEqual([]);
    },
  );

  it('prints a coverage summary', () => {
    const total = operations.length;
    const covered = total - uncovered.length;
    // eslint-disable-next-line no-console
    console.log(
      `\nEndpoint coverage: ${covered}/${total} operations exercised` +
        (uncovered.length
          ? `\nUncovered:\n` +
            uncovered
              .map((op) => `  - ${op.method.toUpperCase()} ${op.template}`)
              .join('\n') +
            (enforced ? '' : '\n(set COVERAGE_GUARD=1 to fail on gaps)')
          : ' — full coverage 🎉') +
        '\n',
    );
    expect(covered).toBeLessThanOrEqual(total);
  });
});
