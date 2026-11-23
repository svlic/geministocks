import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../persistence/store';
import { defaultScoring,type ScreeningResult } from '../../shared/screening-schema';
import { demoFixture } from './fixtures';
const mocks=vi.hoisted(()=>({call:vi.fn(),website:vi.fn(),pdf:vi.fn(),search:vi.fn()}));
vi.mock('../gateway/index',()=>({callModel:mocks.call}));
vi.mock('../ingestion/index',()=>({ingestWebsite:mocks.website,extractPdf:mocks.pdf}));
vi.mock('./public-search',()=>({discoverPublicEvidence:mocks.search}));
import { executeScreening,type Snapshot } from './orchestrator';
let dir:string,store:Store,fixture:ScreeningResult,snapshot:Snapshot;
beforeEach(()=>{
  vi.resetAllMocks();dir=mkdtempSync(join(tmpdir(),'screening-flow-'));store=new Store(dir,'cd'.repeat(32));
  fixture=demoFixture('job','standard');fixture.evidence[0].url='https://public.example.org';
  snapshot={demoMode:false,scoring:defaultScoring,policy:{version:'1',prompt:'',rules:[]},models:[{id:'m',provider:'openai',modelId:'configured-test-model',roles:['research','team','synthesis'],enabled:true,apiKey:store.encrypt('private-test-key'),timeoutMs:10000,maxOutputTokens:8000,allowConfidential:true}]};
  store.db.prepare('INSERT INTO screening_jobs(id,owner,status,phase,input,snapshot,expires) VALUES (?,?,?,?,?,?,?)').run('job','admin','running','reading','{}',store.encrypt(snapshot),Date.now()+86400000);
  mocks.website.mockResolvedValue({evidence:fixture.evidence,limitations:[]});
  mocks.search.mockResolvedValue({evidence:[],limitations:[],searchUsed:true});
  mocks.pdf.mockResolvedValue({evidence:[{...fixture.evidence[0],id:'private',type:'uploaded_deck',url:null,documentId:'deck',page:1,quoteOrSummary:'SECRET-DECK-CONTENT'}],limitations:[]});
  mocks.call.mockImplementation(async(_config,request)=>{
    let value:unknown;
    if(request.system.includes('Extract company identity'))value={company:fixture.company,dimensions:fixture.dimensions,missingMaterials:fixture.missingMaterials,policyAssessment:{ruleIds:[],confidence:0,evidenceIds:[],ambiguous:true}};
    else if(request.system.includes('Independently screen only'))value=fixture.team;
    else value={summary:fixture.summary,dimensions:fixture.dimensions,sectorAndPositioning:fixture.sectorAndPositioning,productAndTechnology:fixture.productAndTechnology,directPrivateComps:[],adjacentCompetitors:[],publicCompanyRefs:[],majorStrengths:fixture.majorStrengths,majorRisks:fixture.majorRisks,missingMaterials:fixture.missingMaterials};
    return {text:JSON.stringify(value),citations:[],usage:{input_tokens:1},searchUsed:false,xSearchUsed:false,elapsedMs:5};
  });
});
afterEach(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
const run=(input:unknown={website:'https://public.example.org'})=>executeScreening(store,{id:'job',input:JSON.stringify(input)},snapshot,()=>{},new AbortController().signal);
it('runs independent team analysis on supplied evidence and discloses the absence of external search',async()=>{
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  const result=await run({website:'https://public.example.org',uploadId:'deck',note:'PRIVATE-NOTE'});
  expect(result.mode).toBe('standard');expect(result.dimensions[0].weightPercent).toBe(30);
  // The team's 4,3,3,4,null gives 105/30 = 3.5, not a synthesis replacement.
  expect(result.dimensions[0].score0to5).toBe(3.5);expect(result.execution).toMatchObject({provider:'openai',searchUsed:false,xSearchUsed:false});
  expect(result.limitations.join(' ')).toContain('external_search_unavailable');
  expect(result.evidence.map(e=>e.id)).toEqual(['private',...fixture.evidence.map(e=>e.id)]);
});
it('writes a limited report for insufficient evidence without fabricating founders or running team scoring',async()=>{
  fixture=demoFixture('job','insufficient');
  fixture.productAndTechnology=[{text:'已读取的产品自述 / Retrieved product statement',verification:'company_claim',evidenceIds:['demo-web']}];
  const result=await run();expect(result.mode).toBe('brief_insufficient');expect(result.totalScore).toBeNull();expect(result.team).toBeNull();expect(result.directPrivateComps).toEqual([]);
  expect(mocks.call.mock.calls.some(c=>c[1].system.includes('Independently screen only'))).toBe(false);
  expect(result.productAndTechnology).toEqual(fixture.productAndTechnology);
});
it('distinguishes provider 503 from company information gaps without demo fallback',async()=>{
  mocks.call.mockRejectedValue(new Error('503 private-key-do-not-echo'));
  const result=await run();expect(result.mode).toBe('failed');expect(result.execution.provider).not.toBe('demo-fixture');expect(JSON.stringify(result)).not.toContain('private-key-do-not-echo');
});
it('omits confidential data from every role when one downstream role is not permitted',async()=>{
  snapshot.models[0].allowConfidential=false;writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  await run({website:'https://public.example.org',uploadId:'deck'});
  for(const c of mocks.call.mock.calls)expect(c[1].input).not.toContain('SECRET-DECK-CONTENT');
});
it('rejects invented ledger IDs instead of publishing fake verified conclusions',async()=>{
  fixture.majorStrengths=[{text:'Invented source claim',verification:'verified',evidenceIds:['nonexistent']}];
  const result=await run();expect(result.mode).toBe('partial_error');expect(result.majorStrengths).toEqual([]);
  expect(result.team!.status).toBe('evaluated');expect(result.dimensions.find(d=>d.id==='product_technology')!.score0to5).not.toBeNull();
});
it('does not bind a same-name external biography without a company identity link',async()=>{
  fixture.evidence[0].quoteOrSummary='本公司创始人张三负责产品。';
  fixture.team!.founders[0].name='张三';
  fixture.team!.founders[0].professionalFacts=[{text:'张三毕业于某大学',verification:'verified',evidenceIds:['unrelated-bio']}];
  fixture.evidence.push({...fixture.evidence[0],id:'unrelated-bio',type:'third_party',url:'https://independent.example.org/source',title:'同名人物',quoteOrSummary:'张三毕业于某大学，曾在另一家公司任职。另一个张三从事医学。'});
  const result=await run();
  expect(result.team!.founders[0].professionalFacts).toEqual([]);
  expect(result.team!.status).toBe('insufficient_evidence');
  expect(result.dimensions.find(d=>d.id==='team')!.score0to5).toBeNull();
  expect(result.totalScore).toBeNull();
});
it('does not manufacture founders or team scores from generic expertise claims',async()=>{
  fixture.evidence[0].quoteOrSummary='团队由行业专家组成，未披露姓名或履历。';
  const result=await run();
  expect(result.team!.status).toBe('insufficient_evidence');expect(result.team!.founders).toEqual([]);
  expect(result.dimensions.find(d=>d.id==='team')!.score0to5).toBeNull();expect(result.totalScore).toBeNull();
});
it('uses server policy and stops before full research on a precise hard exclusion',async()=>{
  snapshot.policy={version:'private-policy',prompt:'',rules:[{id:'exclude',name:'明确不关注',kind:'hard_exclude',sectorTags:['coding-agent'],definition:'Code modification',conditions:'',enabled:true,priority:1,notes:''}]};
  const previous=mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async(config,request)=>{
    const response=await previous(config,request);
    if(request.system.includes('Extract company identity')){
      const entity=JSON.parse(response.text);entity.policyAssessment={ruleIds:['exclude'],confidence:.99,evidenceIds:['demo-web'],ambiguous:false};response.text=JSON.stringify(entity);
    }
    return response;
  });
  const result=await run();
  expect(result.mode).toBe('brief_policy');expect(result.policyMatch.policyVersion).toBe('private-policy');
  expect(result.team).toBeNull();expect(result.dimensions).toEqual([]);expect(result.directPrivateComps).toEqual([]);expect(result.totalScore).toBeNull();
});
it('only aggregates team sub-scores with their own sufficient, bound professional evidence',async()=>{
  delete fixture.team!.subScoreEvidence!.founderMarketFit;
  fixture.team!.subScoreEvidence!.complementarity!.evidenceState='partial';
  fixture.team!.subScoreEvidence!.trackRecord!.evidenceIds=[];
  fixture.team!.subScores.commitment=5;
  const result=await run();
  expect(result.team!.subScores).toEqual({founderMarketFit:null,complementarity:null,trackRecord:null,execution:4,commitment:null});
  expect(result.dimensions.find(d=>d.id==='team')!.score0to5).toBe(4);
  expect(result.team!.subScoreEvidence!.execution!.rationale).toContain('iteration');
});
it.each([true,false])('PDF-only website evidence requires a publicly confirmed company identity: %s',async confirmed=>{
  const website='https://public.example.org';fixture.company!.website=website+'/private-deck?token=PRIVATE-URL-TOKEN';
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  mocks.pdf.mockResolvedValue({evidence:[{...fixture.evidence[0],type:'uploaded_deck',url:null,documentId:'deck',page:1,quoteOrSummary:`${fixture.company!.name} ${fixture.company!.website} 示例创始人 A / Fictional founder A SECRET-DECK-CONTENT`}],limitations:[]});
  mocks.website.mockResolvedValue({evidence:[{...fixture.evidence[0],id:'public-site',quoteOrSummary:confirmed?`${fixture.company!.name} public product page`:'Unrelated public organization'}],limitations:[]});
  const result=await run({uploadId:'deck'});
  expect(result.execution.searchUsed).toBe(false);
  expect(result.evidence.some(e=>e.id==='public-site')).toBe(confirmed);
  expect(mocks.website.mock.calls[0][0]).toBe(website);
  if(!confirmed)expect(result.limitations.join(' ')).toContain('identity_unconfirmed');
});

it('does not let an unavailable website or sparse PDF pages block usable deck evidence',async()=>{
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  mocks.website.mockRejectedValue(new Error('network-private-detail'));
  mocks.pdf.mockResolvedValue({evidence:fixture.evidence.map(e=>({...e,type:'uploaded_deck',url:null,documentId:'deck',page:1})),limitations:['pdf_sparse_pages: Pages 12, 13 have little text; other pages remain usable.']});
  const result=await run({website:'https://public.example.org',uploadId:'deck'});
  expect(result.mode).toBe('standard');expect(result.productAndTechnology).toEqual(fixture.productAndTechnology);
  expect(result.limitations.join(' ')).toContain('website_read_failed');expect(JSON.stringify(result)).not.toContain('network-private-detail');
});

it('continues with the website when PDF parsing fails and retains only retrieved evidence',async()=>{
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');mocks.pdf.mockRejectedValue(new Error('damaged-private-detail'));
  const result=await run({website:'https://public.example.org',uploadId:'deck'});
  expect(result.mode).toBe('standard');expect(result.evidence).toEqual(fixture.evidence);expect(result.limitations.join(' ')).toContain('pdf_read_failed');
});

it('treats entirely blank PDFs and empty websites as evidence gaps, not technical exceptions',async()=>{
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  mocks.pdf.mockResolvedValue({evidence:[],limitations:['pdf_sparse_pages: 1, 2']});mocks.website.mockResolvedValue({evidence:[],limitations:[]});
  const result=await run({website:'https://public.example.org',uploadId:'deck'});
  expect(result.mode).toBe('brief_insufficient');expect(result.totalScore).toBeNull();expect(result.missingMaterials.length).toBeGreaterThan(0);expect(mocks.call).not.toHaveBeenCalled();
  expect(result.limitations.join(' ')).not.toContain('technical_error');
});

it('accepts fenced structured model answers using the existing JSON parser',async()=>{
  const previous=mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async(config,request)=>{const response=await previous(config,request);return {...response,text:`\u0060\u0060\u0060json\n${response.text}\n\u0060\u0060\u0060`};});
  expect((await run()).mode).toBe('standard');
});

it('makes one bounded correction for a completed malformed answer, without replaying provider errors',async()=>{
  mocks.call.mockResolvedValueOnce({text:'{"company":null}',elapsedMs:1,usage:null});
  expect((await run()).mode).toBe('standard');
});

it('does not let synthesis manufacture a team score when independent analysis failed and extraction omitted team',async()=>{
  const previous=mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async(config,request)=>{
    if(request.system.includes('Independently screen only'))throw new Error('team unavailable');
    const response=await previous(config,request);
    if(request.system.includes('Extract company identity')){const value=JSON.parse(response.text);value.dimensions=value.dimensions.filter((d:any)=>d.id!=='team');response.text=JSON.stringify(value);}
    return response;
  });
  const result=await run();expect(result.mode).toBe('partial_error');expect(result.team).toBeNull();expect(result.productAndTechnology).toEqual(fixture.productAndTechnology);
  expect(result.dimensions.find(d=>d.id==='team')!.score0to5).toBeNull();expect(result.totalScore).toBeNull();
});

it('returns validated results before the hard job deadline instead of losing them to worker timeout',async()=>{
  const previous=mocks.call.getMockImplementation()!;const clock=vi.spyOn(Date,'now');const start=Date.now();
  try{
    mocks.call.mockImplementation(async(config,request)=>{const response=await previous(config,request);if(request.system.includes('Extract company identity'))clock.mockReturnValue(start+8*60_000);return response;});
    const result=await run();expect(result.mode).toBe('partial_error');expect(result.company!.name).toBe(fixture.company!.name);
    expect(result.dimensions.find(d=>d.id==='product_technology')!.score0to5).not.toBeNull();expect(result.limitations.join(' ')).toContain('analysis_time_budget_exceeded');
  }finally{clock.mockRestore();}
});

it('does not lose identity and dimensions if optional public identity enrichment fails',async()=>{
  fixture.company!.website='https://public.example.org';
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  mocks.pdf.mockResolvedValue({evidence:fixture.evidence.map(e=>({...e,type:'uploaded_deck',url:null,documentId:'deck',page:1,quoteOrSummary:e.quoteOrSummary+' https://public.example.org'})),limitations:[]});
  mocks.website.mockRejectedValue(new Error('site unavailable'));
  const result=await run({uploadId:'deck'});expect(result.mode).toBe('standard');expect(result.team).not.toBeNull();
});

it('searches on only the public hostname before giving up on an empty website',async()=>{
  snapshot.searchApiKey=store.encrypt('search-private-key');mocks.website.mockResolvedValue({evidence:[],limitations:[]});
  mocks.search.mockResolvedValue({evidence:fixture.evidence,limitations:[],searchUsed:true});
  const result=await run({website:'https://public.example.org/private-path?token=PRIVATE-TOKEN',note:'PRIVATE-NOTE'});
  expect(mocks.search).toHaveBeenCalledWith('https://public.example.org','search-private-key',expect.any(AbortSignal));
  expect(result.mode).toBe('standard');expect(result.execution.searchUsed).toBe(true);
});

it('continues with existing evidence when public search fails',async()=>{
  snapshot.searchApiKey=store.encrypt('search-private-key');mocks.search.mockRejectedValue(new Error('upstream-private-data'));
  const result=await run();expect(result.mode).toBe('standard');expect(result.limitations.join(' ')).toContain('public_search_failed');expect(JSON.stringify(result)).not.toContain('upstream-private-data');
});

it('never searches using unconfirmed PDF-only identity, notes or private URLs',async()=>{
  snapshot.searchApiKey=store.encrypt('search-private-key');fixture.company!.website='https://public.example.org/private?token=PRIVATE-TOKEN';
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  mocks.pdf.mockResolvedValue({evidence:fixture.evidence.map(e=>({...e,type:'uploaded_deck',url:null,documentId:'deck',page:1,quoteOrSummary:e.quoteOrSummary+' '+fixture.company!.website})),limitations:[]});
  mocks.website.mockResolvedValue({evidence:[],limitations:[]});
  const result=await run({uploadId:'deck',note:'PRIVATE-NOTE'});
  expect(mocks.search).not.toHaveBeenCalled();expect(result.execution.searchUsed).toBe(false);
});

it('propagates cancellation instead of publishing an incomplete successful report',async()=>{
  const controller=new AbortController();mocks.website.mockImplementation(async()=>{controller.abort();throw new Error('cancelled');});
  await expect(executeScreening(store,{id:'job',input:JSON.stringify({website:'https://public.example.org'})},snapshot,()=>{},controller.signal)).rejects.toThrow();
});
