import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

// Monorepo lane only (installed by scripts/into-monorepo.sh). Same settings as
// the upstream zk-loan example: remote runs read wallet seeds from the repo-root
// .env.<network>, shell env still wins. `yarn wallets:new` at the root makes one.
const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const envFromFile = isRemote ? loadEnv(network, repoRoot, '') : {};

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: envFromFile,
    testTimeout: 10 * 60_000,
    // A remote wallet build plus the faucet funding gate needs far longer than
    // a local devnet's beforeAll.
    hookTimeout: isRemote ? 90 * 60_000 : 15 * 60_000,
    include: ['test/**/*.test.ts', 'onchain/**/*.test.ts'],
    reporters: ['default'],
    sequence: { concurrent: false },
    disableConsoleIntercept: true,
  },
});
