// Custom Jest sequencer: run every spec alphabetically, but force the coverage
// guard (zz-coverage) to run LAST so it observes the routes every other spec
// hit. Jest's default sequencer orders by file size / cached timings, which
// does NOT guarantee the "zz" file runs last.
const Sequencer = require("@jest/test-sequencer").default;

class CoverageLastSequencer extends Sequencer {
  sort(tests) {
    const isCoverage = (t) => t.path.includes("zz-coverage");
    return Array.from(tests).sort((a, b) => {
      const aCov = isCoverage(a);
      const bCov = isCoverage(b);
      if (aCov !== bCov) return aCov ? 1 : -1;
      return a.path < b.path ? -1 : 1;
    });
  }
}

module.exports = CoverageLastSequencer;
