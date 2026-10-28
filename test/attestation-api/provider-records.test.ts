import { it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createServer } from '../../attestation-api/server.js';
import { generateKeyPair } from '../../attestation-api/signing.js';
import type { AttestationResponse } from '../../attestation-api/types.js';

it('uses provider records instead of caller-supplied figures and refuses unknown keys', async () => {
  setNetworkId('undeployed');
  const server = createServer(generateKeyPair().sk, 1, key => key === '123' ?
    { repaymentScore: 610, monthlySavings: 1200, monthsAsMember: 12 } : undefined);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = (key: string) => fetch(base + '/attest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userPubKeyHash: key, repaymentScore: 999, monthlySavings: 99999, monthsAsMember: 99 }) });
    const response = await post('123');
    expect(response.status).toBe(200);
    const data = await response.json() as AttestationResponse;
    expect(data.message.monthlySavings).toBe('1200');
    expect(data.message.repaymentScore).toBe('610');
    expect((await post('456')).status).toBe(404);
  } finally { await new Promise<void>(resolve => server.close(()=>resolve())); }
});
