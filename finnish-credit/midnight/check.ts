import assert from 'node:assert/strict';
import {Contract,ledger} from './managed/contract/index.js';
import {createConstructorContext,createCircuitContext,sampleContractAddress} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {createEitherTestUser} from '../../test/utils/address.js';
for(const flags of [0n,2n]){
 const user=createEitherTestUser('Alice');
 const c=new Contract<{flags:bigint}>({riskFlags:({privateState})=>[privateState,privateState.flags]});
 const init=c.initialState(createConstructorContext({flags},user.left.hex));
 const ctx=createCircuitContext(sampleContractAddress(),init.currentZswapLocalState,init.currentContractState,init.currentPrivateState);
 const subject=new Uint8Array(32).fill(1);
 const result=c.impureCircuits.recordEligibility(ctx,subject);
 assert.equal(ledger(result.context.currentQueryContext.state).eligibility.lookup(subject),flags===0n);
 console.log(`PASS compiled Compact: flags=${flags}, eligible=${flags===0n}; local execution only`);
}
