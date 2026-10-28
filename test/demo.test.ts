// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 Ermias Bunaro. Part of fairway-credit-gate.
//
// Runs the exact scenario `make demo` prints, so the screen-share script cannot
// silently rot. Assertions mirror the claims the demo makes out loud.

import { describe, it, expect, beforeAll } from 'vitest';
import { runScenario, type ScenarioResult } from '../demo/scenario.js';

describe('demo scenario (what `make demo` shows)', () => {
  let result: ScenarioResult;

  beforeAll(async () => {
    result = await runScenario();
  });

  it('records one outcome per synthetic member: Tier 1, accepted Tier 2 offer, membership-gate rejection', () => {
    expect(result.loans.map((l) => [l.member, l.status, l.amount])).toEqual([
      ['member-A', 'Approved', 8000n],
      ['member-B', 'Approved', 7000n],
      ['member-C', 'Rejected', 0n],
    ]);
  });

  it('refuses tampering, replay, an unregistered signer and a non-admin registration', () => {
    expect(result.refusals.map((r) => r.error)).toEqual([
      'Invalid attestation signature',
      'Invalid attestation signature',
      'Attestation provider not registered',
      'Only admin can register providers',
    ]);
  });

  it('leaves only outcomes on the public ledger', () => {
    expect(result.ledgerFields).toEqual(['blacklist', 'contractAdmin', 'loans', 'onGoingPinMigration', 'providers']);
    expect(result.loanRecordFields).toEqual(['authorizedAmount', 'status']);
    expect(result.privateNumbers).toHaveLength(9);
    expect(result.privateNumbersOnLedger).toEqual([]);
  });
});
