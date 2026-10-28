// This file is part of sacco-credit-gate, derived from midnightntwrk/midnight-examples (examples/zk-loan).
// Original work Copyright (C) Midnight Foundation. Modifications Copyright (C) 2026 Ermias Bunaro.
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// TypeScript implementations of the contract's witnesses — the off-chain logic
// Compact cannot express. Each witness receives a WitnessContext and returns a
// tuple [nextPrivateState, returnValue]. Ported from
// midnightntwrk/example-zkloan (contract/src/witnesses.ts).
//
// Remember: witness output is UNTRUSTED from the circuit's point of view. The
// contract verifies the attestation signature over the profile, checks the
// Schnorr reduction arithmetic, and only ever uses the secret through hashes.
import { type Witnesses } from './managed/sacco-credit-gate/contract/index.js';

// Mirrors the generated `Schnorr_SchnorrSignature`: a JubjubPoint is carried
// across the TS boundary as its affine coordinates `{ x, y }`.
export type SchnorrSignature = {
  announcement: { x: bigint; y: bigint };
  response: bigint;
};

// Every browser/CLI instance carries a single 32-byte user secret in private
// state. All identity in the contract — per-user loan identity AND the admin
// role — derives from this one secret via domain-separated hashes inside the ZK
// circuit. Whoever's `deriveAdminPublicKey(userSecretKey)` was pinned into
// `contractAdmin` at deploy time holds the admin role; everyone else fails the
// equality assertion inside the proof.
//
// The credit fields plus `attestationSignature`/`attestationProviderId` are
// what a registered provider signed off-chain (in upstream, the attestation
// API; here, the test signs with src/test/utils/test-data.ts). They never
// reach the ledger.
export type SaccoCreditGatePrivateState = {
  repaymentScore: bigint;
  monthlySavings: bigint;
  monthsAsMember: bigint;
  attestationSignature: SchnorrSignature;
  attestationProviderId: bigint;
  userSecretKey: Uint8Array;
};

// A private state holding only a user secret and an empty (unsigned) profile.
// Enough to deploy and to call admin circuits; `requestLoan` additionally needs
// a signed profile (see `createCustomSignedProfile` in the test utilities).
export const createSaccoCreditGatePrivateState = (userSecretKey: Uint8Array): SaccoCreditGatePrivateState => ({
  repaymentScore: 0n,
  monthlySavings: 0n,
  monthsAsMember: 0n,
  attestationSignature: { announcement: { x: 0n, y: 0n }, response: 0n },
  attestationProviderId: 0n,
  userSecretKey,
});

// 2^248 — schnorr.compact truncates the BLS12-381 challenge hash to 248 bits so
// it is a valid Jubjub scalar.
const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;

// The `Witnesses<SaccoCreditGatePrivateState>` annotation is load-bearing: leaving it to
// inference collapses the private-state type parameter to `never` and breaks
// the deploy/call overloads.
export const witnesses: Witnesses<SaccoCreditGatePrivateState> = {
  // Hands the circuit the private profile, the provider's signature over it,
  // and which provider signed. The circuit re-derives the message and verifies
  // the signature before trusting any of it.
  getAttestedScoringWitness: ({ privateState }) => [
    privateState,
    [
      {
        repaymentScore: privateState.repaymentScore,
        monthlySavings: privateState.monthlySavings,
        monthsAsMember: privateState.monthsAsMember,
      },
      privateState.attestationSignature,
      privateState.attestationProviderId,
    ],
  ],

  // Witness-assisted division: cheap here, and the circuit checks
  // `q * 2^248 + r == challengeHash` with q bounded, so a dishonest answer is
  // rejected rather than trusted.
  getSchnorrReduction: ({ privateState }, challengeHash) => {
    const q = challengeHash / TWO_248;
    const r = challengeHash % TWO_248;
    return [privateState, [q, r]];
  },

  // The single source of caller identity. Validate the length so a malformed
  // private state fails loudly at proof time rather than as an opaque
  // circuit error.
  getUserSecret: ({ privateState }) => {
    if (!privateState.userSecretKey || privateState.userSecretKey.length !== 32) {
      throw new Error('getUserSecret: userSecretKey is missing or wrong length');
    }
    return [privateState, privateState.userSecretKey];
  },
};
