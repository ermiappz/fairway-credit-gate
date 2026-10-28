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

// Test fixtures: sample profiles and signed private states. Ported from
// midnightntwrk/example-zkloan (contract/src/test/utils/test-data.ts). Signs
// in-process with the attestation API's signer, for the simulator tests that
// don't need HTTP; the on-chain suite goes through the API server itself.

import { type SaccoCreditGatePrivateState } from '../../contract/witnesses.js';
import { generateKeyPair, sign as schnorrSign } from '../../attestation-api/signing.js';
import * as crypto from 'crypto';

export const userProfiles = [
  {
    applicantId: 'user-001',
    repaymentScore: 720,
    monthlySavings: 2500,
    monthsAsMember: 24,
  },
  {
    applicantId: 'user-002',
    repaymentScore: 650,
    monthlySavings: 1800,
    monthsAsMember: 11,
  },
  {
    applicantId: 'user-003',
    repaymentScore: 580,
    monthlySavings: 2200,
    monthsAsMember: 36,
  },
  {
    applicantId: 'user-004',
    repaymentScore: 710,
    monthlySavings: 1900,
    monthsAsMember: 5,
  },
  {
    applicantId: 'user-005',
    repaymentScore: 520,
    monthlySavings: 3000,
    monthsAsMember: 48,
  },
  {
    applicantId: 'user-006',
    repaymentScore: 810,
    monthlySavings: 4500,
    monthsAsMember: 60,
  },
  {
    applicantId: 'user-007',
    repaymentScore: 639,
    monthlySavings: 2100,
    monthsAsMember: 18,
  },
  {
    applicantId: 'user-008',
    repaymentScore: 680,
    monthlySavings: 1450,
    monthsAsMember: 30,
  },
  {
    applicantId: 'user-009',
    repaymentScore: 750,
    monthlySavings: 2100,
    monthsAsMember: 23,
  },
  {
    applicantId: 'user-010',
    repaymentScore: 579,
    monthlySavings: 1900,
    monthsAsMember: 12,
  },
];

// Key generation and Schnorr signing are the attestation API's own code
// (attestation-api/signing.ts), so these tests exercise the real signer.
export { schnorrSign };
export const generateProviderKeyPair = generateKeyPair;

export function generateUserSecret(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

export function createSignedUserProfile(
  index: number,
  providerSk: bigint,
  userPubKeyHash: bigint,
  providerId: bigint = 1n,
  userSecretKey: Uint8Array = generateUserSecret(),
): SaccoCreditGatePrivateState {
  const profile = userProfiles[index];
  if (!profile) {
    throw new Error(`Index ${index} is out of bounds. Must be between 0 and ${userProfiles.length - 1}.`);
  }

  const msg: bigint[] = [
    BigInt(profile.repaymentScore),
    BigInt(profile.monthlySavings),
    BigInt(profile.monthsAsMember),
    userPubKeyHash,
  ];

  const signature = schnorrSign(providerSk, msg);

  return {
    repaymentScore: BigInt(profile.repaymentScore),
    monthlySavings: BigInt(profile.monthlySavings),
    monthsAsMember: BigInt(profile.monthsAsMember),
    attestationSignature: signature,
    attestationProviderId: providerId,
    userSecretKey,
  };
}

export function createCustomSignedProfile(
  repaymentScore: bigint,
  monthlySavings: bigint,
  monthsAsMember: bigint,
  providerSk: bigint,
  userPubKeyHash: bigint,
  providerId: bigint = 1n,
  userSecretKey: Uint8Array = generateUserSecret(),
): SaccoCreditGatePrivateState {
  const msg: bigint[] = [repaymentScore, monthlySavings, monthsAsMember, userPubKeyHash];
  const signature = schnorrSign(providerSk, msg);

  return {
    repaymentScore,
    monthlySavings,
    monthsAsMember,
    attestationSignature: signature,
    attestationProviderId: providerId,
    userSecretKey,
  };
}

export function getUserProfile(
  index?: number,
  userSecretKey: Uint8Array = generateUserSecret(),
): SaccoCreditGatePrivateState {
  let profile;
  if (index !== undefined) {
    if (index < 0 || index >= userProfiles.length) {
      throw new Error(`Index ${index} is out of bounds. Must be between 0 and ${userProfiles.length - 1}.`);
    }
    profile = userProfiles[index];
  } else {
    const randomIndex = Math.floor(Math.random() * userProfiles.length);
    profile = userProfiles[randomIndex];
  }
  return {
    repaymentScore: BigInt(profile.repaymentScore),
    monthlySavings: BigInt(profile.monthlySavings),
    monthsAsMember: BigInt(profile.monthsAsMember),
    attestationSignature: { announcement: { x: 0n, y: 0n }, response: 0n },
    attestationProviderId: 0n,
    userSecretKey,
  };
}
