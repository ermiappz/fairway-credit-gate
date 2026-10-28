# Walkthrough

This guide goes through the code file by file. It is written for someone who
knows TypeScript but has not used Midnight or Compact. Sections 1 to 5 cover the
ideas you need, sections 6 to 9 cover the files, and it ends with five
self-check questions.

All member data in this repository is synthetic.

---

## 1. The mental model: a circuit is a function you prove you ran

On most blockchains every node re-runs your transaction, so every input is
public. Midnight works differently:

1. The contract's entry points are **circuits**, written in Compact
   (`contract/sacco-credit-gate.compact`).
2. The **user's device** runs the circuit locally on inputs that can include
   private data.
3. A prover turns that run into a **zero-knowledge proof**: "I ran
   `requestLoan` correctly, every `assert` held, and these are the public
   effects."
4. The chain **checks the proof** and applies the public effects (ledger
   writes). It never sees the private inputs.

Two consequences shape the whole design:

- **If an `assert` fails, no proof exists.** A member with a tampered profile
  does not get a rejected transaction. They cannot build a transaction at all.
  That is why the demo's refused attempts leave no trace on the ledger.
- **Anything written to the ledger is public forever.** So the contract has to
  be careful about what it writes, and the compiler helps (section 3).

## 2. Witnesses: private inputs from the outside world

A circuit cannot read files, call APIs or look at a wallet. When it needs data
from outside, it calls a **witness**: a function declared in Compact and
implemented in TypeScript.

```compact
witness getAttestedScoringWitness(): [Applicant, Schnorr_SchnorrSignature, Uint<16>];
witness getUserSecret(): UserSecretKey;
```

The implementations live in `contract/witnesses.ts` and read from the member's
**private state**, a local object that never leaves the device:

```ts
getUserSecret: ({ privateState }) => [privateState, privateState.userSecretKey],
```

The most important rule: **the circuit must not trust witness output.** The
person running the circuit wrote or can modify the witness code. A dishonest
member could make `getAttestedScoringWitness` return a repayment score of 800.
So every witness value in this contract is either:

- **verified**: the profile is only used after the SACCO's signature over it
  checks out (section 4), or
- **used only through a hash**: the secret is never compared or stored
  directly. It is hashed into a key, and you cannot produce the right key
  without knowing the secret.

The third witness, `getSchnorrReduction` in `schnorr.compact`, is a different
use: the circuit asks the outside world to do a division that is expensive
inside a circuit, then **checks** the answer. Section 4 explains why that check
needed fixing.

## 3. `disclose()`: making data leaks visible in the code

Compact tracks which values are derived from witness data. If such a value
could become public (written to the ledger, returned from an exported circuit),
the compiler refuses to compile unless you wrap it in `disclose(...)`.

`disclose()` does not publish anything by itself. It is a declaration: "I know
this value comes from private data and I accept that it may become visible
here." It turns every potential leak into a line a reviewer can search for.

The places this contract discloses, and why each is acceptable:

| Where | What | Why it is OK |
|---|---|---|
| `constructor` | `deriveAdminPublicKey(secret)` | a hash of the admin's secret, not the secret |
| `requestLoan` | the member key | a hash of PIN + secret; it has to be public because it is the map key |
| `requestLoan` | `topTierAmount`, `status` | the outcome, which is the point of the contract |
| `evaluateApplicant` | `providerId` | reveals which SACCO signed, nothing about the member |
| admin circuits | arguments like `providerId`, `newAdmin` | already public inputs chosen by the admin |

What is never disclosed: `repaymentScore`, `monthlySavings`, `monthsAsMember`,
the signature, the secret, the PIN. If a future edit tried to write
`profile.monthlySavings` to the ledger, it would fail to compile until someone
typed `disclose(` around it, and that line would stand out in review.

The test `never writes the member profile to the public ledger` and the demo's
final check confirm the result from the outside.

## 4. Schnorr verification inside the circuit

The SACCO is the source of truth about its members. The contract has to answer
one question: **did a registered SACCO sign exactly these figures, for exactly
this member?** It uses a Schnorr signature on the Jubjub curve, because Jubjub
arithmetic is cheap inside Midnight's proof system.

**Signing** (off chain, `attestation-api/signing.ts`). The SACCO has secret
key `sk` and public key `pk = sk·G`, where `G` is the curve's generator.

```text
msg = [repaymentScore, monthlySavings, monthsAsMember, memberKeyHash]
k   = fresh random number          (never reused: reuse leaks sk)
R   = k·G                          (the "announcement")
c   = Hash(R, pk, msg) mod 2^248   (the "challenge")
s   = k + c·sk  mod Jubjub order   (the "response")
signature = (R, s)
```

**Verifying** (in the circuit, `contract/schnorr.compact`):

```text
check  s·G == R + c·pk
```

This works because `s·G = (k + c·sk)·G = k·G + c·(sk·G) = R + c·pk`. Only
someone who knows `sk` can produce an `s` that makes the equation hold for a
challenge they did not choose.

Three details matter:

1. **The message ends with `memberKeyHash`.** The circuit rebuilds the message
   using the caller's own derived key. A signature issued to member A fails
   for member B, even with identical figures. That is the replay protection in
   the demo ("member-E replays member-A's signed profile").
2. **The key must be registered.** `evaluateApplicant` looks the SACCO's public
   key up in the `providers` map, which only the admin can change. A
   self-made signing key fails with `Attestation provider not registered`.
3. **The challenge reduction must be checked properly.** The hash returns a
   number up to about 2^255, but curve multiplication needs a scalar below the
   Jubjub order (about 2^252). The circuit truncates to 248 bits. Division is
   expensive in a circuit, so a witness supplies the quotient `q` and remainder
   `r`, and the circuit checks `q·2^248 + r == hash`. The catch: circuit
   arithmetic is modulo a large prime. If `q` could be any field element, an
   attacker could pick any `r` they liked and solve for a `q` that makes the
   equation hold modulo the prime, which means choosing their own challenge
   and forging a signature. The fix is to declare `q` as `Uint<7>` and assert
   `q < 116`. The largest honest quotient is 115, and with `q` that small the
   equation has to hold over ordinary integers, so `r` is pinned to the real
   hash. The test `rejects a forged attestation that exploits an unconstrained
   challenge quotient` builds that exact forgery and checks it is refused.

The off-chain signer calls the contract's own compiled `schnorrChallenge` pure
circuit instead of re-implementing the hash, so both sides compute the same
challenge.

## 5. Why the tiers are fixed amounts

The circuit returns one of four results: Rejected, or 10,000 / 7,000 / 3,000
ETB. A more natural rule, such as "lend up to 3 × monthly savings", would be
a privacy bug.

Everything the circuit discloses is public. If the ledger records a limit of
4,500 and the formula is public (it is: the contract source is public), anyone
can divide by three and learn that this member saves 1,500 ETB a month. Any
limit that is a function of a private number leaks that number, often exactly.

Fixed tiers turn a precise number into a coarse band:

| What the ledger shows | What an observer learns |
|---|---|
| `Proposed, 7,000` | the member is in Tier 2: repayment ≥ 600 and savings ≥ 1,500, but not Tier 1 |
| `Approved, 2,000` (asked for 2,000) | the member's tier allows at least 2,000; not which tier |
| `Rejected, 0` | below Tier 3 **or** under six months of membership; not which |

The membership gate is checked first for the same reason. A rejected member's
tenure is never published, and from the outside a new member looks the same
as one with a weak repayment record.

Bands still leak something. A `Proposed` outcome reveals the exact tier, and a
member who borrows repeatedly reveals a trajectory. The README lists this under
honest scope.

---

## 6. `contract/`: the Compact contract and its TypeScript glue

### `sacco-credit-gate.compact`

The contract. Read it top to bottom:

- **Types.** `LoanStatus` (Approved, Rejected, Proposed, NotAccepted),
  `LoanApplication` (the only per-loan data on the ledger: amount and status),
  and `Applicant` (the private profile; deliberately not exported).
  `UserPublicKey` and `AdminPublicKey` are distinct `new type`s over
  `Bytes<32>`, so the compiler stops you passing one where the other belongs.
- **Ledger.** `blacklist`, `loans` (member key → loan id → loan),
  `onGoingPinMigration`, `contractAdmin`, `providers`. That is the complete
  public state.
- **Identity.** `deriveUserPublicKey(secret, pin)` and
  `deriveAdminPublicKey(secret)` hash the one 32-byte secret with different
  domain-separation strings (`"sacco:member:pk:1"`, `"sacco:admin:pk:v01"`), so
  the two keys can never collide. The contract never uses `ownPublicKey()`,
  because that value is claimed by the prover and not bound to anything.
- **`requestLoan`.** Derives the caller's key, checks the blacklist and that no
  PIN migration is in progress, hashes the key with `transientHash` (cheap, for
  values used inside the circuit) to bind the attestation, calls
  `evaluateApplicant`, and discloses only the outcome.
- **`evaluateApplicant`.** Not exported, so it only runs inside
  `requestLoan`'s proof. It gets the profile and signature from the witness,
  checks the SACCO is registered, verifies the signature, then applies the
  membership gate and the tiers.
- **`createLoan`.** Caps the amount at the tier maximum, turns over-asks into
  `Proposed`, and appends the loan under the member's key.
- **`respondToLoan`.** Accepts or declines a Proposed loan. No separate owner
  check is needed: only someone with the right secret and PIN derives the key
  the loan is stored under.
- **Admin circuits.** `blacklistUser`, `registerProvider`, `rotateAdmin` and
  the others each assert `contractAdmin == deriveAdminPublicKey(getUserSecret())`.
  The admin key hash is public, but only the holder of the secret can satisfy
  the equality.
- **`changePin`.** Moves a member's loans to the key derived from a new PIN.
  Circuits cannot loop over a collection of unknown size, so it moves a fixed
  batch of five per call (the loop bound is a compile-time constant) and keeps
  a cursor in `onGoingPinMigration`.

### `schnorr.compact`

A Compact `module` (no ledger of its own) imported with
`import "schnorr" prefix Schnorr_;`. It contains `schnorrVerify` and the
`schnorrChallenge` hash (section 4). Upstream marks it as a temporary
polyfill until the standard library ships a Schnorr verifier.

### `witnesses.ts`

The TypeScript side of the three witnesses, plus the `SaccoCreditGatePrivateState`
type: the profile, the SACCO's signature, the provider id, and the secret.
`getUserSecret` rejects a secret that is not 32 bytes, so a malformed state
fails with a clear message instead of an obscure circuit error.

### `index.ts`

Re-exports the compiled contract and wraps it in `CompiledContract.make(...)`
with the witnesses and the path to the compiled assets. The devnet lane uses
that wrapper. The simulator lane only needs the `Contract` class and
`pureCircuits`.

### `managed/sacco-credit-gate/`

Compiler output from `compactc 0.31.1 --skip-zk`: the JavaScript
implementation of every circuit (`contract/index.js`), its types
(`index.d.ts`), circuit metadata, and the ZK intermediate representation
(`zkir/`). It is committed so the tests run with Node alone. CI recompiles and
fails if the committed copy is stale. A full `compact compile` (without
`--skip-zk`) also produces proving keys, which only the devnet lane needs.

## 7. `attestation-api/`: the SACCO's side

- **`signing.ts`**: Schnorr signing on Jubjub (section 4). `signCreditData`
  builds the message in the exact order the circuit rebuilds it.
- **`server.ts`**: a small restify service: `POST /attest`,
  `GET /provider-info` (the public key the admin registers), `GET /health`.
  **It signs whatever it is sent.** A real SACCO signer would authenticate the
  member and read the figures from its own books.
- **`types.ts`**: wire types. JSON has no bigint, so field-sized values travel
  as decimal strings.
- **`index.ts`**: standalone entry point (`make attestation`). Uses
  `PROVIDER_SECRET_KEY` if set, otherwise an ephemeral key.

Note what the member sends: the figures and `transientHash(memberKey)`. The
SACCO never learns the member's secret or PIN, and the key it signs for cannot
be traced back to them.

## 8. `test/`: the simulator lane

- **`sacco-credit-gate.simulator.ts`**: builds a contract in memory, generates
  a SACCO key pair and an admin secret, deploys, registers the provider, and
  exposes one method per circuit. Each call runs the compiled JavaScript
  circuit with every assert and every ledger operation, and skips proof
  generation. A constructor option lets a test swap in a malicious witness,
  which is how the forgery test works.
- **`sacco-credit-gate.sim.test.ts`**: 65 contract tests: tier boundaries,
  the membership gate, Proposed/accept/decline, blacklist, PIN migration over
  several batches, admin rotation, provider management, tampering, replay, the
  quotient forgery, and the ledger-holds-only-outcomes check.
- **`attestation-api/*.test.ts`**: 10 tests of the signer (does `s·G == R + c·pk`
  hold off chain?) and of the HTTP API on a random local port.
- **`demo.test.ts`**: 3 tests that run `demo/scenario.ts` and assert what the
  demo says out loud, so the screen-share script cannot drift from the code.
- **`utils/`**: synthetic profiles and signing helpers.

## 9. `demo/`, `onchain/`, and the build

- **`demo/scenario.ts`**: the end-to-end story as a function: start the
  signing service over HTTP, deploy, register, three synthetic members, four
  refused attempts, then inspect the ledger. Requested amounts are chosen so
  they never equal a private figure, which means "no private value on the
  ledger" cannot pass by coincidence.
- **`demo/demo.ts`**: prints the scenario for `make demo`.
- **`onchain/`**: the devnet suite (10 tests, real proofs) and its wallet and
  provider plumbing, plus `monorepo/` manifests. It depends on
  `@midnight-ntwrk/example-fast-sync`, which only exists inside
  midnight-examples, so `scripts/into-monorepo.sh` installs this repo there.
  It has not been run against a live devnet for this release.
- **`Makefile`**, **`package.json`**, **`.github/workflows/ci.yml`**: `make test`
  and `make demo` need only Node. CI installs the Compact toolchain, pins
  0.31.1, compiles, checks for drift, typechecks, tests and runs the demo.
  `package-lock.json` is committed and installed with `npm ci`. That pins the
  `ledger-v8` and `onchain-runtime-v3` versions the monorepo uses, and avoids an
  npm 10 resolver crash on vitest 4's optional peer dependencies.

---

## Self-check questions

Try to answer each one before opening the answer.

**1. A member edits `monthlySavings` in their private state from 1,200 to
2,600 after the SACCO signed. What happens, and where?**

<details><summary>Answer</summary>

On the member's own device, the circuit rebuilds the signed message from the
edited figures, the Schnorr check `s·G == R + c·pk` fails, and the assert
`Invalid attestation signature` stops execution. No proof can be produced, so
nothing reaches the chain and no ledger entry is created.
</details>

**2. Why does `requestLoan` wrap the member key in `disclose()` but never
`monthlySavings`? What would happen if someone wrote `monthlySavings` to the
ledger without `disclose()`?**

<details><summary>Answer</summary>

The member key has to be public because it is the key of the `loans` map, and
it is a hash, so disclosing it reveals neither the secret nor the PIN. Savings
are exactly what the contract exists to hide. Writing a witness-derived value
to the ledger without `disclose()` is a compile error, so the leak could only
happen with a visible, reviewable `disclose(` in the source.
</details>

**3. Member B holds a valid SACCO signature that was issued to member A, with
the same figures. Why can't B use it?**

<details><summary>Answer</summary>

The last element of the signed message is `transientHash(memberKey)`, and the
circuit computes it from the caller's own secret and PIN. B's key is different,
so the message the circuit rebuilds differs from what the SACCO signed, and the
signature check fails.
</details>

**4. The Schnorr quotient `q` used to be a `Field`. Why was that a soundness
bug, and what does `q < 116` fix?**

<details><summary>Answer</summary>

The check `q·2^248 + r == hash` is evaluated modulo the field prime. With `q`
unconstrained, an attacker could choose any challenge `r` and solve for a
matching `q`, then build `R = s·G − r·pk` and forge a valid-looking signature
without the SACCO's key. Bounding `q` to at most 115 (the largest honest value)
forces the equation to hold over ordinary integers, so `r` must be the real
hash truncated to 248 bits.
</details>

**5. Why not set the loan limit to "3 × monthly savings"? What does a fixed
tier still reveal?**

<details><summary>Answer</summary>

The limit is disclosed and the formula is public, so the ledger would reveal
savings exactly (limit ÷ 3). Fixed tiers reveal only a band. They still leak
something: a `Proposed` outcome shows the exact tier, a `Rejected` outcome
shows the member is below Tier 3 or under six months, and repeated requests
can reveal a trajectory over time.
</details>
