import { defineConfig } from 'vitest/config';

// Standalone lane: contract logic against the in-memory simulator, plus the
// SACCO signing service. Nothing here needs Docker, a node, or a proof server.
// The devnet suite lives in onchain/ and only runs inside the midnight-examples
// monorepo (see "Devnet lane" in README.md).
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    // Each simulator test builds a fresh contract and signs fresh attestations;
    // generous but bounded so a hung circuit fails instead of stalling CI.
    testTimeout: 60_000,
    sequence: { concurrent: false },
  },
});
