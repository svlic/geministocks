import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../persistence/store';
import { defaultScoring,type ScreeningResult } from '../../shared/screening-schema';
import { demoFixture } from './fixtures';
const mocks=vi.hoisted(()=>({call:vi.fn(),website:vi.fn(),pdf:vi.fn(),page:vi.fn()}));
vi.mock('../gateway/index',()=>({callModel:mocks.call}));
vi.mock('../ingestion/index',()=>({ingestWebsite:mocks.website,extractPdf:mocks.pdf,fetchPublicPage:mocks.page}));
import { executeScreening,type Snapshot } from './orchestrator';
let dir:string,store:Store,fixture:ScreeningResult,snapshot:Snapshot;
beforeEach(()=>{
  vi.resetAllMocks();dir=mkdtempSync(join(tmpdir(),'screening-flow-'));store=new Store(dir,'cd'.repeat(32));
  fixture=demoFixture('job','standard');fixture.evidence[0].url='https://public.example.org';
  snapshot={demoMode:false,scoring:defaultScoring,policy:{version:'1',prompt:'',rules:[]},models:[{id:'m',provider:'xai',modelId:'configured-test-model',roles:['research','team','synthesis'],enabled:true,apiKey:store.encrypt('private-test-key'),timeoutMs:10000,maxOutputTokens:8000,webSearch:true,xSearch:true,allowConfidential:true}]};
  store.db.prepare('INSERT INTO screening_jobs(id,owner,status,phase,input,snapshot,expires) VALUES (?,?,?,?,?,?,?)').run('job','admin','running','reading','{}',store.encrypt(snapshot),Date.now()+86400000);
  mocks.website.mockResolvedValue({evidence:fixture.evidence,limitations:[]});mocks.page.mockResolvedValue({url:'https://independent.example.org/source',title:'Independent fixture',text:'Public product evidence'});
  mocks.pdf.mockResolvedValue({evidence:[{...fixture.evidence[0],id:'private',type:'uploaded_deck',url:null,documentId:'deck',page:1,quoteOrSummary:'SECRET-DECK-CONTENT'}],limitations:[]});
  mocks.call.mockImplementation(async(_config,request)=>{
    let value:unknown;
    if(request.search)return {text:'Research',citations:[{url:'https://independent.example.org/source',title:'Source'}],usage:{input_tokens:1},searchUsed:true,xSearchUsed:true,elapsedMs:10};
    if(request.system.includes('Extract company identity'))value={company:fixture.company,dimensions:fixture.dimensions,missingMaterials:fixture.missingMaterials,policyAssessment:{ruleIds:[],confidence:0,evidenceIds:[],ambiguous:true}};
    else if(request.system.includes('Independently screen only'))value=fixture.team;
    else value={summary:fixture.summary,dimensions:fixture.dimensions,sectorAndPositioning:fixture.sectorAndPositioning,productAndTechnology:fixture.productAndTechnology,directPrivateComps:[],adjacentCompetitors:[],publicCompanyRefs:[],majorStrengths:fixture.majorStrengths,majorRisks:fixture.majorRisks,missingMaterials:fixture.missingMaterials};
    return {text:JSON.stringify(value),citations:[],usage:{input_tokens:1},searchUsed:false,xSearchUsed:false,elapsedMs:5};
  });
});
afterEach(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
const run=(input:unknown={website:'https://public.example.org'})=>executeScreening(store,{id:'job',input:JSON.stringify(input)},snapshot,()=>{},new AbortController().signal);
it('runs independent team analysis, retains refreshed search evidence and never exposes deck to search',async()=>{
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  const result=await run({website:'https://public.example.org',uploadId:'deck',note:'PRIVATE-NOTE'});
  expect(result.mode).toBe('standard');expect(result.dimensions[0].weightPercent).toBe(30);
  // The team's 4,3,3,4,null gives 105/30 = 3.5, not a synthesis replacement.
  expect(result.dimensions[0].score0to5).toBe(3.5);expect(result.execution.searchUsed).toBe(true);
  const calls=mocks.call.mock.calls.map(c=>c[1]);
  for(const c of calls.filter(c=>c.search)){expect(c.input).not.toContain('SECRET-DECK-CONTENT');expect(c.input).not.toContain('PRIVATE-NOTE');}
  const entityCalls=calls.filter(c=>c.system.includes('Extract company identity'));expect(entityCalls[1].input).toContain('search-');
  expect(store.db.prepare('SELECT * FROM job_usage').all().length).toBeGreaterThan(3);
});
it('stops at insufficient evidence without fabricating founders or invoking full modules',async()=>{
  fixture=demoFixture('job','insufficient');
  const result=await run();expect(result.mode).toBe('brief_insufficient');expect(result.totalScore).toBeNull();expect(result.team).toBeNull();expect(result.directPrivateComps).toEqual([]);
  expect(mocks.call.mock.calls.some(c=>c[1].system.includes('Independently screen only'))).toBe(false);
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
  const result=await run();expect(result.mode).toBe('partial_error');expect(result.totalScore).toBeNull();expect(result.majorStrengths).toEqual([]);
});
it('does not bind a same-name external biography without a company identity link',async()=>{
  fixture.evidence[0].quoteOrSummary='本公司创始人张三负责产品。';
  fixture.team!.founders[0].name='张三';
  fixture.team!.founders[0].professionalFacts=[{text:'张三毕业于某大学',verification:'verified',evidenceIds:['search-1']}];
  mocks.page.mockResolvedValue({url:'https://independent.example.org/source',title:'同名人物',text:'张三毕业于某大学，曾在另一家公司任职。另一个张三从事医学。'});
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
it.each([true,false])('PDF-only search requires a publicly confirmed company identity: %s',async confirmed=>{
  const website='https://public.example.org';fixture.company!.website=website+'/private-deck?token=PRIVATE-URL-TOKEN';
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  mocks.pdf.mockResolvedValue({evidence:[{...fixture.evidence[0],type:'uploaded_deck',url:null,documentId:'deck',page:1,quoteOrSummary:`${fixture.company!.name} ${fixture.company!.website} 示例创始人 A / Fictional founder A SECRET-DECK-CONTENT`}],limitations:[]});
  mocks.website.mockResolvedValue({evidence:[{...fixture.evidence[0],id:'public-site',quoteOrSummary:confirmed?`${fixture.company!.name} public product page`:'Unrelated public organization'}],limitations:[]});
  const result=await run({uploadId:'deck'});
  expect(result.execution.searchUsed).toBe(confirmed);
  const searchInputs=mocks.call.mock.calls.filter(c=>c[1].search).map(c=>c[1].input);
  expect(searchInputs.length>0).toBe(confirmed);
  for(const input of searchInputs){expect(JSON.parse(input)).toEqual({officialWebsite:website});expect(input).not.toContain('SECRET-DECK-CONTENT');}
  if(!confirmed)expect(result.limitations.join(' ')).toContain('identity_unconfirmed');
});
