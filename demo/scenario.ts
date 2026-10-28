// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 Ermias Bunaro. Part of fairway-credit-gate.
//
// The end-to-end story behind `make demo`, written as a function so the test
// suite can run exactly what the demo shows (test/demo.test.ts).
//
// Three parties, three places data lives:
//   SACCO        signs a member's profile off chain (attestation-api over HTTP)
//   member       holds secret + PIN + signed profile; their device runs the circuit
//   ledger       public state; must end up holding only outcomes
//
// It runs on the in-memory simulator from the test harness. The simulator
// executes the same compiled circuit logic a real proof would encode, including
// every assert, but skips proof generation. If an assert fails here, a real
// prover could not produce a proof either, so the transaction never reaches
// the chain. The devnet lane in onchain/ does the same with real proofs.
//
// All member data below is SYNTHETIC.

import type { AddressInfo } from 'node:net';
import { CompactTypeBytes, transientHash, type JubjubPoint } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { LoanStatus, pureCircuits, type Ledger } from '../contract/index.js';
import type { SaccoCreditGatePrivateState } from '../contract/witnesses.js';
import { createServer } from '../attestation-api/server.js';
import { generateKeyPair, signCreditData } from '../attestation-api/signing.js';
import type { AttestationResponse, ProviderInfoResponse } from '../attestation-api/types.js';
import { SaccoCreditGateSimulator } from '../test/sacco-credit-gate.simulator.js';
import { generateUserSecret } from '../test/utils/test-data.js';

export const SACCO_PROVIDER_ID = 1;

export type Profile = { repaymentScore: number; monthlySavings: number; monthsAsMember: number };

export type SyntheticMember = {
  label: string;
  story: string;
  profile: Profile;
  pin: bigint;
  request: number;
  // For a Proposed outcome: does the member take the smaller offer?
  acceptsOffer?: boolean;
};

// Synthetic members chosen to hit each branch of evaluateApplicant. Requested
// amounts deliberately differ from every private number, so the privacy check
// at the end cannot pass by coincidence.
export const MEMBERS: SyntheticMember[] = [
  {
    label: 'member-A',
    story: 'long-standing saver, strong repayment record',
    profile: { repaymentScore: 720, monthlySavings: 2500, monthsAsMember: 30 },
    pin: 4821n,
    request: 8000,
  },
  {
    label: 'member-B',
    story: 'good record, asks for more than Tier 2 allows',
    profile: { repaymentScore: 650, monthlySavings: 1800, monthsAsMember: 14 },
    pin: 1937n,
    request: 9000,
    acceptsOffer: true,
  },
  {
    label: 'member-C',
    story: 'excellent numbers, but joined 4 months ago',
    profile: { repaymentScore: 790, monthlySavings: 3100, monthsAsMember: 4 },
    pin: 6604n,
    request: 2000,
  },
];

export type LoanRow = { member: string; memberKeyHex: string; loanId: bigint; status: string; amount: bigint };
export type Refusal = { attempt: string; error: string };

export type ScenarioResult = {
  providerPk: JubjubPoint;
  loans: LoanRow[];
  refusals: Refusal[];
  ledgerFields: string[];
  loanRecordFields: string[];
  privateNumbers: number[];
  privateNumbersOnLedger: number[];
};

export type Logger = {
  step(title: string): void;
  line(text: string): void;
  ok(text: string): void;
  fail(text: string): void;
};

const silent: Logger = { step() {}, line() {}, ok() {}, fail() {} };

const bytes32 = new CompactTypeBytes(32);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const short = (b: Uint8Array) => `0x${hex(b).slice(0, 10)}…`;
const etb = (n: number | bigint) => `${Number(n).toLocaleString('en-US')} ETB`;
const statusName = (s: LoanStatus) => LoanStatus[s] ?? String(s);

// What the member's device computes locally before asking for an attestation.
// Only this hash goes to the SACCO, never the secret or the PIN.
function memberKeyHash(secret: Uint8Array, pin: bigint): { key: Uint8Array; hash: bigint } {
  const key = pureCircuits.deriveUserPublicKey(secret, pin);
  return { key, hash: transientHash(bytes32, key) };
}

async function askSaccoToAttest(baseUrl: string, profile: Profile, userPubKeyHash: bigint) {
  const res = await fetch(`${baseUrl}/attest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...profile, userPubKeyHash: userPubKeyHash.toString() }),
  });
  if (!res.ok) throw new Error(`attestation API returned ${res.status}`);
  const body = (await res.json()) as AttestationResponse;
  // JSON has no bigint; the wire format is decimal strings.
  return {
    announcement: { x: BigInt(body.signature.announcement.x), y: BigInt(body.signature.announcement.y) },
    response: BigInt(body.signature.response),
  };
}

function privateStateFor(
  secret: Uint8Array,
  profile: Profile,
  signature: SaccoCreditGatePrivateState['attestationSignature'],
  providerId: number,
): SaccoCreditGatePrivateState {
  return {
    repaymentScore: BigInt(profile.repaymentScore),
    monthlySavings: BigInt(profile.monthlySavings),
    monthsAsMember: BigInt(profile.monthsAsMember),
    attestationSignature: signature,
    attestationProviderId: BigInt(providerId),
    userSecretKey: secret,
  };
}

// Runs a circuit that is expected to be refused; returns the assert message.
function expectRefusal(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // compact-runtime prefixes assert failures; keep the contract's own text.
    return msg.replace(/^.*failed assert:\s*/i, '').trim();
  }
  throw new Error('expected the circuit to refuse this transaction, but it succeeded');
}

export async function runScenario(log: Logger = silent, members: SyntheticMember[] = MEMBERS): Promise<ScenarioResult> {
  setNetworkId('undeployed');

  // ── 1. The SACCO's signing service ──────────────────────────────────────
  log.step('1. SACCO starts its signing service (off chain)');
  const sacco = generateKeyPair(); // ephemeral demo key; production keys live in an HSM
  const providerRecords = new Map<string, Profile>();
  const server = createServer(sacco.sk, SACCO_PROVIDER_ID, hash => providerRecords.get(hash));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const info = (await (await fetch(`${baseUrl}/provider-info`)).json()) as ProviderInfoResponse;
    const providerPk: JubjubPoint = { x: BigInt(info.publicKey.x), y: BigInt(info.publicKey.y) };
    log.line(`attestation API on ${baseUrl}  (POST /attest, GET /provider-info)`);
    log.line(`provider id ${info.providerId}, Jubjub public key x=${info.publicKey.x.slice(0, 14)}…`);

    // ── 2. Deploy and register ────────────────────────────────────────────
    log.step('2. Admin deploys the contract and registers the SACCO key on the ledger');
    const sim = new SaccoCreditGateSimulator();
    const adminSecret = sim.userSecretKey;
    sim.registerProvider(BigInt(SACCO_PROVIDER_ID), providerPk);
    log.line(`contractAdmin = ${short(sim.getLedger().contractAdmin)}  (hash of the admin's secret, not the secret)`);
    log.line(`providers[${SACCO_PROVIDER_ID}] = SACCO public key`);

    // ── 3. Members borrow ─────────────────────────────────────────────────
    log.step('3. Members request loans (synthetic data)');
    const keys = new Map<string, Uint8Array>();
    const privateNumbers: number[] = [];

    for (const m of members) {
      const secret = generateUserSecret();
      const { key, hash } = memberKeyHash(secret, m.pin);
      keys.set(m.label, key);
      privateNumbers.push(m.profile.repaymentScore, m.profile.monthlySavings, m.profile.monthsAsMember);
      // Fixture enrollment represents the provider's verified books. The API
      // resolves this record instead of trusting amounts sent by the borrower.
      providerRecords.set(hash.toString(), { ...m.profile });

      log.line('');
      log.line(`${m.label}: ${m.story}`);
      log.line(
        `  on device only : repayment ${m.profile.repaymentScore}, savings ${etb(m.profile.monthlySavings)}/month, ` +
          `${m.profile.monthsAsMember} months, secret + PIN`,
      );
      const signature = await askSaccoToAttest(baseUrl, m.profile, hash);
      log.line(`  SACCO signs    : profile bound to member key ${short(key)}`);

      sim.circuitContext.currentPrivateState = privateStateFor(secret, m.profile, signature, SACCO_PROVIDER_ID);
      sim.requestLoan(BigInt(m.request), m.pin);
      let loan = sim.getLedger().loans.lookup(key).lookup(1n);
      log.line(`  requests       : ${etb(m.request)}`);
      log.ok(`  ledger records : ${statusName(loan.status)}, ${etb(loan.authorizedAmount)}`);

      if (loan.status === LoanStatus.Proposed && m.acceptsOffer !== undefined) {
        sim.respondToLoan(1n, m.pin, m.acceptsOffer);
        loan = sim.getLedger().loans.lookup(key).lookup(1n);
        log.ok(`  accepts offer  : ${statusName(loan.status)}, ${etb(loan.authorizedAmount)}`);
      }
    }

    // ── 4. Attacks the circuit must refuse ────────────────────────────────
    log.step('4. Attempts the circuit refuses (no proof, so no transaction)');
    const refusals: Refusal[] = [];

    // 4a. Edit the profile after the SACCO signed it.
    {
      const secret = generateUserSecret();
      const pin = 2222n;
      const honest: Profile = { repaymentScore: 610, monthlySavings: 1200, monthsAsMember: 12 };
      const { hash } = memberKeyHash(secret, pin);
      providerRecords.set(hash.toString(), { ...honest });
      const signature = await askSaccoToAttest(baseUrl, honest, hash);
      // 1,200/month lands in Tier 3 (3,000 ETB); 2,600 would lift this member to Tier 2.
      const edited = { ...honest, monthlySavings: 2600 };
      sim.circuitContext.currentPrivateState = privateStateFor(secret, edited, signature, SACCO_PROVIDER_ID);
      const error = expectRefusal(() => sim.requestLoan(9000n, pin));
      refusals.push({ attempt: 'member-D edits savings 1,200 → 2,600 after signing', error });
    }

    // 4b. Reuse someone else's attestation.
    {
      const a = MEMBERS[0]!;
      const aSecret = generateUserSecret();
      providerRecords.set(memberKeyHash(aSecret, a.pin).hash.toString(), { ...a.profile });
      const signedForA = await askSaccoToAttest(baseUrl, a.profile, memberKeyHash(aSecret, a.pin).hash);
      const thief = generateUserSecret();
      sim.circuitContext.currentPrivateState = privateStateFor(thief, a.profile, signedForA, SACCO_PROVIDER_ID);
      const error = expectRefusal(() => sim.requestLoan(5000n, a.pin));
      refusals.push({ attempt: "member-E replays member-A's signed profile", error });
    }

    // 4c. A signer the admin never registered.
    {
      const rogue = generateKeyPair();
      const secret = generateUserSecret();
      const pin = 3333n;
      const fake: Profile = { repaymentScore: 800, monthlySavings: 5000, monthsAsMember: 60 };
      const sig = signCreditData(rogue.sk, fake.repaymentScore, fake.monthlySavings, fake.monthsAsMember, memberKeyHash(secret, pin).hash);
      sim.circuitContext.currentPrivateState = privateStateFor(secret, fake, sig, 7);
      const error = expectRefusal(() => sim.requestLoan(10000n, pin));
      refusals.push({ attempt: 'self-made signer claims to be provider 7', error });
    }

    // 4d. Admin-only circuit called by a member.
    {
      sim.setUserSecret(generateUserSecret());
      const error = expectRefusal(() => sim.registerProvider(8n, generateKeyPair().pk));
      refusals.push({ attempt: 'a member tries to register their own signer', error });
      sim.setUserSecret(adminSecret);
    }

    for (const r of refusals) log.fail(`${r.attempt}\n      refused: "${r.error}"`);

    // ── 5. What the public ledger holds ───────────────────────────────────
    log.step('5. The public ledger after all of the above');
    const ledger: Ledger = sim.getLedger();
    const ledgerFields = Object.keys(ledger).sort();
    const loans: LoanRow[] = [];
    const loanRecordFields = new Set<string>();
    // The generated API cannot iterate the outer level of a nested Map, so walk
    // the member keys we know. Every one is present and the sizes match, so
    // there is no entry the walk could have missed.
    const allKnown = [...keys.values()].every((k) => ledger.loans.member(k));
    if (!allKnown || ledger.loans.size() !== BigInt(keys.size)) {
      throw new Error(`ledger has ${ledger.loans.size()} member keys, expected exactly our ${keys.size}`);
    }
    for (const [label, key] of keys) {
      for (const [loanId, loan] of ledger.loans.lookup(key)) {
        Object.keys(loan).forEach((f) => loanRecordFields.add(f));
        loans.push({
          member: label,
          memberKeyHex: hex(key),
          loanId,
          status: statusName(loan.status),
          amount: loan.authorizedAmount,
        });
      }
    }

    log.line(`ledger fields : ${ledgerFields.join(', ')}`);
    log.line(`member keys   : ${ledger.loans.size()} (refused attempts left no entry)`);
    log.line(`providers     : ${[...ledger.providers].map(([id]) => id).join(', ')}`);
    log.line('loans         :');
    for (const l of loans) {
      log.line(`  ${`0x${l.memberKeyHex.slice(0, 10)}…`}  #${l.loanId}  ${l.status.padEnd(9)} ${etb(l.amount).padStart(10)}   (${l.member})`);
    }

    // Every number the ledger carries per loan, checked against every private
    // number any member held. Amounts were chosen so a hit would be a real leak.
    const publicNumbers = new Set(loans.map((l) => Number(l.amount)));
    const privateNumbersOnLedger = privateNumbers.filter((n) => publicNumbers.has(n));
    const recordFields = [...loanRecordFields].sort();
    log.line('');
    log.ok(`each loan record holds only: ${recordFields.join(', ')}`);
    if (privateNumbersOnLedger.length === 0) {
      log.ok(`none of the ${privateNumbers.length} private profile values appear on the ledger`);
    } else {
      log.fail(`private values found on the ledger: ${privateNumbersOnLedger.join(', ')}`);
    }

    return {
      providerPk,
      loans,
      refusals,
      ledgerFields,
      loanRecordFields: recordFields,
      privateNumbers,
      privateNumbersOnLedger,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
