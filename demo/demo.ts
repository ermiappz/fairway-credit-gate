// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 Ermias Bunaro. Part of fairway-credit-gate.
//
// `make demo`: prints the scenario in demo/scenario.ts for a screen share.
// No network beyond localhost, no Docker, no keys. Colour is skipped when the
// output is not a terminal or NO_COLOR is set, so the log pastes cleanly.

import { runScenario, type Logger } from './scenario.js';

const useColor = process.stdout.isTTY && !process.env['NO_COLOR'];
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const red = paint('31');
const cyan = paint('36');

const log: Logger = {
  step: (title) => console.log(`\n${bold(cyan(title))}`),
  line: (text) => console.log(text ? `   ${text}` : ''),
  ok: (text) => console.log(`${green(' ✓')} ${text}`),
  fail: (text) => console.log(`${red(' ✗')} ${text}`),
};

console.log(bold('fairway-credit-gate demo'));
console.log(dim('simulator lane: compiled circuits run in memory, proofs skipped. All member data is synthetic.'));

const started = Date.now();
runScenario(log)
  .then((result) => {
    const leaks = result.privateNumbersOnLedger.length;
    console.log(
      `\n${bold('Done')} in ${((Date.now() - started) / 1000).toFixed(1)}s: ` +
        `${result.loans.length} loans recorded, ${result.refusals.length} attempts refused, ` +
        `${leaks === 0 ? green('0 private values on the ledger') : red(`${leaks} private values on the ledger`)}.`,
    );
    process.exit(leaks === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(red(`demo failed: ${err instanceof Error ? err.stack : String(err)}`));
    process.exit(1);
  });
