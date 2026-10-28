export function createKaamosViews({data,key,esc,pill,showDocument}){
  let selected=data.cases?.[0]?.id,screen='landing';
  const base='https://github.com/fairway-global/kaamos-otc';
  const sha='2f6425cc7d819337bf2373f3f49972cbf7b34bea';
  const source=path=>`${base}/blob/${sha}/${path}`;
  function handoff(c){return {
    schema:'fairway.kaamos-advisory-preview.v1',assessment_id:c.id,policy_version:'DEMO-0.1',
    decision:c.decision,currency:'ETB',recommended_amount:c.recommended_amount,authorized_amount:0,
    approval_status:'pending_two_distinct_human_approvers',source_references:c.reasons.map(r=>r.citation),
    kaamos:{repository:base,source_commit:sha,rfq_id:null,token_amount:null,fx_rate:null},
    execution_enabled:false,notice:'Advisory demo contract. Not a Kaamos API payload; no trade submitted.'};}
  function render(){
    const c=data.cases?.find(c=>c.id===selected);
    const img=screen==='landing'?'assets/kaamos-landing.png':'assets/kaamos-swap.png';
    document.querySelector('#content').innerHTML=`<section class="kaamos-intro"><div><span class="eyebrow">BUILT ALONGSIDE KAAMOS OTC</span><h2>Credit review meets<br>the settlement workflow.</h2><p>Kaamos is Fairway’s existing Cardano–Midnight OTC prototype. These credit components explore the review steps around that settlement experience.</p><div class="detail-actions"><a class="button primary" href="https://kaamos.fairway.global" target="_blank" rel="noreferrer">Open Kaamos demo ↗</a><a class="button" href="${base}" target="_blank" rel="noreferrer">Existing project on GitHub ↗</a></div><p class="supporting">Preprod prototype · separate credit policies · no trade execution from this workspace.</p></div><div class="kaamos-preview panel"><div class="panel-head"><div class="tabs"><button data-screen="landing" class="tab ${screen==='landing'?'active':''}">Landing</button><button data-screen="swap" class="tab ${screen==='swap'?'active':''}">Swap screen</button></div><span class="small muted">Actual Kaamos screen</span></div><a href="https://kaamos.fairway.global/${screen==='swap'?'app':''}" target="_blank" rel="noreferrer"><img src="${img}" alt="Kaamos ${screen==='landing'?'landing page':'preprod swap interface without a connected wallet'}" loading="lazy" /></a><p class="small muted">${screen==='landing'?'Screenshot from the Kaamos repository.':'Public swap screen captured 28 October 2026, without connecting a wallet.'} Open the demo to interact.</p></div></section>
      <div class="component-flow"><a href="${esc(data.urls.credit)}"><span>01 / CREDIT DESK</span><strong>Assess the institution</strong><small>Evidence, policy checks, facility caps</small></a><div><span>02 / REVIEW</span><strong>Human authorization</strong><small>Two distinct approvers required</small></div><a href="${esc(data.urls.gate)}"><span>03 / CREDIT GATE</span><strong>Explore eligibility</strong><small>Separate member-policy simulation</small></a><a href="https://kaamos.fairway.global/app" target="_blank" rel="noreferrer"><span>04 / KAAMOS OTC</span><strong>Existing settlement</strong><small>Cardano + Midnight HTLC contracts ↗</small></a></div>
      <div class="notice">Conceptual component map. Credit Desk and Credit Gate are add-on demonstrations; Kaamos does not currently enforce their outputs. Credit recommendations in ETB are not token amounts, and no FX conversion is assumed.</div>
      <div class="two-col"><div class="panel"><div class="panel-head"><h2>Existing Kaamos components</h2>${pill('Source verified','green')}</div><div class="panel-body component-links">${[
        ['Midnight escrow','contract/src/htlc.compact','Compact HTLC: hashlock, claim and reclaim'],
        ['Cardano escrow','cardano/validators/htlc.ak','Aiken validator on the other side of settlement'],
        ['RFQ → settlement adapter','htlc-orchestrator/src/services/swap-bridge.ts','Maps accepted trade terms into swap parameters'],
        ['Wallet-driven swap UI','htlc-ui/src/components/swap/SwapCard.tsx','Existing frontend settlement flow'],
        ['RFQ order book','htlc-ui/src/components/orderbook/OrderBook.tsx','Existing quote negotiation interface']
      ].map(([name,path,description])=>`<a href="${source(path)}" target="_blank" rel="noreferrer"><strong>${name} ↗</strong><span>${description}</span><code>${path}</code></a>`).join('')}</div></div>
      <div class="panel"><div class="panel-head"><h2>${c?'Preview a credit handoff':'Where Credit Gate fits'}</h2>${pill('Advisory only','amber')}</div><div class="panel-body">${c?`<label for="handoff-case">Illustrative assessment</label><select id="handoff-case" class="select">${data.cases.map(x=>`<option value="${x.id}" ${x.id===selected?'selected':''}>${esc(x.id+' · '+x.decision)}</option>`).join('')}</select><dl class="kv"><div><dt>Recommendation</dt><dd>${esc(c.decision.replaceAll('_',' '))}</dd></div><div><dt>Authorized amount</dt><dd>ETB 0</dd></div></dl><p class="small muted">This preview carries the assessment reference and review state. A future adapter would need approved terms, token-unit conversion, and an accepted Kaamos RFQ.</p><button class="primary" id="preview-handoff">Inspect handoff JSON</button><pre class="handoff-summary">execution_enabled: false\napproval_status: pending\nrfq_id: null\ntoken_amount: null</pre>`:`<p class="supporting">Credit Gate demonstrates a separate eligibility circuit. It is not a deployed Kaamos permission check. Connecting it would require an explicit policy bridge, authorized attestations, contract integration and end-to-end preprod tests.</p><a class="button" href="${esc(data.urls.credit)}">Open the Credit Desk extension ↗</a>`}</div></div></div>
      <p class="supporting">Kaamos source reference: <a href="${base}/tree/${sha}" target="_blank" rel="noreferrer">${sha.slice(0,7)}</a>. Existing Kaamos screenshots and source are attributed to fairway-global/kaamos-otc (MIT). No wallet was connected and no transaction was submitted.</p>`;
    document.querySelectorAll('[data-screen]').forEach(b=>b.onclick=()=>{screen=b.dataset.screen;render();});
    document.querySelector('#handoff-case')?.addEventListener('change',e=>{selected=e.target.value;render();});
    document.querySelector('#preview-handoff')?.addEventListener('click',()=>showDocument('Kaamos credit extension · advisory handoff','```json\n'+JSON.stringify(handoff(c),null,2)+'\n```'));
  }
  return {render,handoff};
}
