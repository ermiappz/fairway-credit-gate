// Shared lexical retrieval for the private web chat and its offline source-search mode.
// Pure code: no network calls, credentials, or hidden persistence.
const STOP = new Set('a an the is are was were be been being and or of to in on for with from that this it its what which who how me tell about please fairway current latest status now today our we i my does do did can you have has'.split(' '));
export const terms = text => (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(t=>t.length>2&&!STOP.has(t));
const unique = a => [...new Set(a)];
export function isStrategy(question){return /strateg|priorit|roadmap|company.*focus|fairway.*(status|direction)|status.*fairway/i.test(question);}
export function publicQueryFor(question){
  // Never send the private question, previous conversation, or retrieved text to search.
  if(/midnight|compact|zero.?knowledge/i.test(question))return 'Midnight network Compact privacy preserving applications official documentation';
  if(/kaamos|otc|settlement/i.test(question))return 'Kaamos Fairway OTC Cardano Midnight preprod';
  if(/cardano|usdm|stablecoin/i.test(question))return 'Cardano USDM stablecoin official documentation';
  return null;
}
export function retrieve(question, documents, limit=6){
  const raw=unique(terms(question));
  const strategy=isStrategy(question);
  const expanded=unique([...raw,...(strategy?['strategy','roadmap','pilot','institutional','sacco','priorities']:[])]);
  if(!expanded.length)return [];
  const chunks=[];
  for(const doc of documents){
    if(strategy&&doc.id==='doc-demo-credit-policy')continue;
    let parts=doc.body.split(/\n\s*\n/).map(p=>p.trim()).filter(p=>p.length>60&&!p.startsWith('> Source'));
    for(const part of parts){
      // Fixed windows keep the browser and server retrieval results identical.
      for(let at=0;at<part.length;at+=1100){
        const text=part.slice(at,at+1300);
        if(text.length<60)continue;
        const tokens=terms(text),freq={};for(const t of tokens)freq[t]=(freq[t]||0)+1;
        chunks.push({doc,text,freq,length:tokens.length});
      }
    }
  }
  const avg=chunks.reduce((s,c)=>s+c.length,0)/Math.max(chunks.length,1);
  const df={};for(const word of expanded)df[word]=chunks.filter(c=>c.freq[word]).length;
  for(const c of chunks){
    c.score=0;c.coverage=0;
    for(const word of expanded){
      const tf=c.freq[word]||0;if(!tf)continue;
      const idf=Math.log(1+(chunks.length-df[word]+.5)/(df[word]+.5));
      c.score+=idf*tf*2.2/(tf+1.2*(.25+.75*c.length/avg));
      c.coverage++;
    }
    const titleWords=terms(c.doc.title);c.score+=expanded.filter(t=>titleWords.includes(t)).length*1.5;
    if(strategy){
      if(['doc-business-roadmap','doc-gtm-ca-plan','doc-00-canonical-facts-register'].includes(c.doc.id))c.score*=1.4;
      if(c.doc.source_status==='reconstructed-from-linear')c.score*=1.1;
    }
  }
  const enough=Math.min(2,expanded.length);
  const ranked=chunks.filter(c=>c.coverage>=enough&&c.score>2).sort((a,b)=>b.score-a.score);
  const seen=new Set(),hits=[];
  for(const c of ranked){
    if(seen.has(c.doc.id))continue;
    seen.add(c.doc.id);hits.push({id:c.doc.id,title:c.doc.title,source_date:c.doc.source_date,source_status:c.doc.source_status,
      source_path:c.doc.source_path,excerpt:c.text,score:Math.round(c.score*100)/100});
    if(hits.length===limit)break;
  }
  // Recency questions should include the latest available meeting evidence, with its type explicit.
  if(strategy&&hits.length){
    const meeting=ranked.filter(c=>c.doc.type==='meeting').sort((a,b)=>(b.doc.source_date||'').localeCompare(a.doc.source_date||'')||b.score-a.score)[0];
    if(meeting&&!seen.has(meeting.doc.id)){
      hits.splice(limit-1,1,{id:meeting.doc.id,title:meeting.doc.title,source_date:meeting.doc.source_date,source_status:meeting.doc.source_status,
        source_path:meeting.doc.source_path,excerpt:meeting.text,score:Math.round(meeting.score*100)/100});
    }
  }
  return hits;
}
export function freshnessNote(data){
  const f=data.freshness;
  return f?`Latest dated strategy material: ${f.strategy_as_of} (drafts). Latest meeting context: ${f.meeting_context_as_of} (Linear reconstruction). Latest imported transcript: ${f.imported_transcript_as_of}. This does not verify today's business status.`:'This snapshot does not verify today’s business status.';
}
export function extractiveAnswer(question,data){
  const sources=retrieve(question,data.documents);
  return {mode:'extractive',model:null,question,sources,web_sources:[],
    answer:sources.length?'These are matching passages from the available sources. They are quotations, not an AI-generated conclusion.':"I can't answer that from the Fairway vault.",
    refused:!sources.length,freshness:freshnessNote(data),public_query:publicQueryFor(question),
    excerpts:sources.slice(0,4).map(s=>({text:s.excerpt,source_id:s.id}))};
}
