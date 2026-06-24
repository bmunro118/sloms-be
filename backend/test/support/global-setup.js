// Jest globalSetup (plain JS so it runs without the TS/swc transform).
// Clears the cross-spec coverage hits file once at the start of every e2e run,
// so the coverage guard only sees routes exercised by *this* run.
const fs = require("fs");
const os = require("os");
const path = require("path");

module.exports = async () => {
  const hitsFile = path.join(os.tmpdir(), "sloms-e2e-coverage-hits.txt");
  try {
    fs.unlinkSync(hitsFile);
  } catch {
    /* not there — fine */
  }
};
