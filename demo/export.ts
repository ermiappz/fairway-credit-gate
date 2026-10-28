// Execute the actual compiled circuit simulator and export a browser replay.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runScenario, MEMBERS, type SyntheticMember } from './scenario.js';

const members: SyntheticMember[] = [...MEMBERS,
  { label: 'member-F', story: 'Tier 3 boundary; accepts a capped offer', profile: { repaymentScore: 580, monthlySavings: 1100, monthsAsMember: 6 }, pin: 4242n, request: 4500, acceptsOffer: true },
  { label: 'member-G', story: 'Tier 2 member declines the smaller offer', profile: { repaymentScore: 600, monthlySavings: 1500, monthsAsMember: 10 }, pin: 5151n, request: 8500, acceptsOffer: false },
  { label: 'member-H', story: 'Repayment score below the minimum', profile: { repaymentScore: 579, monthlySavings: 2200, monthsAsMember: 18 }, pin: 6262n, request: 2500 },
];
const events: { kind: string; text: string }[] = [];
const result = await runScenario({
  step: text => events.push({ kind: 'step', text }),
  line: text => events.push({ kind: 'line', text }),
  ok: text => events.push({ kind: 'ok', text }),
  fail: text => events.push({ kind: 'refused', text }),
}, members);
const out = process.argv[2] || 'demo/results.json';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ mode: 'compiled-circuit-simulation', synthetic: true,
  notice: 'Actual compiled circuits executed locally. No ZK proof was generated and no network transaction was submitted. Member policy is a separate synthetic reference, not institutional policy DEMO-0.1.',
  members: members.map(({ pin: _pin, ...member }) => member), events, result,
}, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
console.log(`Exported ${result.loans.length} loan outcomes and ${result.refusals.length} refused attempts to ${out}`);
