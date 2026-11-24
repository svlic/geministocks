import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { existsSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
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
    if(request.system.includes('Extract company identity'))value={company:fixture.company,dimensions:fixture.dimensions,missingMaterials:fixture.missingMaterials};
    else if(request.system.includes('Assess investment policy'))value={assessment:null};
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
it('scores a vague but attributable deck-only team without external corroboration or preliminary scores',async()=>{
  fixture.company!.stage='unknown';
  fixture.evidence=fixture.evidence.map(e=>({...e,type:'uploaded_deck',url:null,documentId:'deck',page:17,quoteOrSummary:'FICTIONAL: 示例创始人 A / Fictional founder A leads actuator engineering; relevant experience is claimed but details and execution results are not disclosed.'}));
  fixture.dimensions=fixture.dimensions.map(d=>({...d,score0to5:d.id==='product_technology'?1.75:d.id==='sector_positioning'?1.25:null,evidenceState:d.id==='product_technology'||d.id==='sector_positioning'?'partial':'insufficient'}));
  fixture.team!.status='insufficient_evidence';
  fixture.team!.founders[0].professionalFacts=[{text:'Company identifies the founder as engineering lead; details are incomplete',verification:'company_claim',evidenceIds:['demo-web']}];
  fixture.team!.subScores={founderMarketFit:1.5,complementarity:null,trackRecord:null,execution:null,commitment:null};
  fixture.team!.subScoreEvidence={founderMarketFit:{rationale:'Relevant engineering role is stated; experience and results are incomplete and not independently verified',evidenceIds:['demo-web'],evidenceState:'partial'}};
  mocks.pdf.mockResolvedValue({evidence:fixture.evidence,limitations:[]});mocks.website.mockRejectedValue(new Error('unavailable'));
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  const previous=mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async(config,request)=>{
    const response=await previous(config,request);
    if(request.system.includes('Extract company identity')){
      const entity=JSON.parse(response.text);entity.dimensions=entity.dimensions.map((d:any)=>({...d,score0to5:null}));response.text=JSON.stringify(entity);
    }
    return response;
  });
  const result=await run({uploadId:'deck'});
  expect(result.mode).toBe('standard');expect(result.execution.searchUsed).toBe(false);
  expect(result.team!.status).toBe('evaluated');expect(result.team!.founders[0].professionalFacts[0].verification).toBe('company_claim');
  expect(result.dimensions[0]).toMatchObject({score0to5:1.5,evidenceState:'partial',evidenceIds:['demo-web']});
  expect(result.dimensions[0].rationale).toContain('incomplete');
  expect(result.evidenceCoverage).toBe(.75);expect(result.totalScore).toBe(31);
  expect(result.dimensions.find(d=>d.id==='capital_efficiency')!.score0to5).toBeNull();
});
it.each([4,5])('decides the final report mode from scored coverage at %s percent',async weight=>{
  snapshot.scoring={...defaultScoring,weights:{...defaultScoring.weights,seed:[35-weight,20,15,20,weight,10]}};
  fixture.team!.founders=[];
  fixture.dimensions=fixture.dimensions.map(d=>({...d,score0to5:d.id==='business_economics'?1.5:null,evidenceState:d.id==='business_economics'?'partial':'insufficient'}));
  const result=await run();
  expect(result.evidenceCoverage).toBe(weight/100);
  expect(result.totalScore).toBe(weight===5?30:null);
  expect(result.mode).toBe(weight===5?'standard':'brief_insufficient');
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
  for(const c of mocks.call.mock.calls){expect(c[1].input).not.toContain('SECRET-DECK-CONTENT');expect(c[0].timeoutMs).toBeLessThanOrEqual(10000);}
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
  expect(result.totalScore).toBe(67);expect(result.evidenceCoverage).toBe(.55);
});
it('does not manufacture founders or team scores from generic expertise claims',async()=>{
  fixture.evidence[0].quoteOrSummary='团队由行业专家组成，未披露姓名或履历。';
  const result=await run();
  expect(result.team!.status).toBe('insufficient_evidence');expect(result.team!.founders).toEqual([]);
  expect(result.dimensions.find(d=>d.id==='team')!.score0to5).toBeNull();expect(result.totalScore).toBe(67);
});
it('uses server policy and stops before full research on a precise hard exclusion',async()=>{
  snapshot.policy={version:'private-policy',prompt:'',rules:[{id:'exclude',name:'明确不关注',kind:'hard_exclude',sectorTags:['coding-agent'],definition:'Code modification',conditions:'',enabled:true,priority:1,notes:''}]};
  const previous=mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async(config,request)=>{
    const response=await previous(config,request);
    if(request.system.includes('Assess investment policy'))response.text=JSON.stringify({assessment:{ruleIds:['exclude'],confidence:.99,evidenceIds:['demo-web'],ambiguous:false}});
    return response;
  });
  const result=await run();
  expect(result.mode).toBe('brief_policy');expect(result.policyMatch!.policyVersion).toBe('private-policy');
  expect(result.team).toBeNull();expect(result.dimensions).toEqual([]);expect(result.directPrivateComps).toEqual([]);expect(result.totalScore).toBeNull();
});
it('keeps quality analysis blind to policy while adding focus research-priority points',async()=>{
  const baseline=await run();
  snapshot.policy={version:'focus-policy',prompt:'POLICY-ONLY',rules:[{id:'focus',name:'重点方向',kind:'focus',sectorTags:[],definition:'Developer workflow',conditions:'',enabled:true,priority:1,notes:''}]};
  const previous=mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async(config,request)=>{
    const response=await previous(config,request);
    if(request.system.includes('Assess investment policy'))response.text=JSON.stringify({assessment:{ruleIds:['focus'],confidence:.98,evidenceIds:['demo-web'],ambiguous:false}});
    // Simulate preference-biased quality output if policy leaks into a quality call.
    else if(request.input.includes('POLICY-ONLY')||JSON.parse(request.input).untrustedData.policyMatch){
      const value=JSON.parse(response.text);
      if(value.dimensions)value.dimensions=value.dimensions.map((d:any)=>({...d,score0to5:0}));
      response.text=JSON.stringify(value);
    }
    return response;
  });
  const focused=await run();
  expect(baseline).toMatchObject({mode:'standard',policyMatch:null,policyBonus:0,priorityScore:null,totalScore:68});
  expect(focused).toMatchObject({mode:'standard',policyMatch:{status:'focus'},policyBonus:5,priorityScore:73,totalScore:68});
  expect(focused.dimensions).toEqual(baseline.dimensions);expect(focused.evidenceCoverage).toBe(baseline.evidenceCoverage);
  snapshot.scoring={...defaultScoring,coverageThreshold:1};
  expect(await run()).toMatchObject({mode:'brief_insufficient',policyMatch:{status:'focus'},totalScore:null,policyBonus:0,priorityScore:null});
});
it.each(['disabled','null','unmatched','failure','invalid-evidence'] as const)('permits optional policy assessment: %s',async scenario=>{
  snapshot.policy={version:'optional',prompt:'',rules:[{id:'optional',name:'可选方向',kind:'focus',sectorTags:[],definition:'Developer workflow',conditions:'',enabled:scenario!=='disabled',priority:1,notes:''}]};
  const previous=mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async(config,request)=>{
    if(request.system.includes('Assess investment policy')){
      if(scenario==='failure'||scenario==='disabled')throw new Error('policy unavailable');
      return {text:JSON.stringify({assessment:scenario==='null'?null:{ruleIds:scenario==='unmatched'?[]:['optional'],confidence:.99,evidenceIds:[scenario==='invalid-evidence'?'invented':'demo-web'],ambiguous:false}}),elapsedMs:1};
    }
    return previous(config,request);
  });
  const result=await run();
  expect(result).toMatchObject({mode:'standard',totalScore:68,policyBonus:0,priorityScore:scenario==='unmatched'?68:null});
  if(scenario==='unmatched')expect(result.policyMatch?.status).toBe('unknown');
  else expect(result.policyMatch).toBeNull();
  expect(result.limitations.some(l=>l.startsWith('policy_module_failed'))).toBe(scenario==='failure'||scenario==='invalid-evidence');
});
it('accepts conservative partial team scores but still rejects missing or unbound professional evidence',async()=>{
  delete fixture.team!.subScoreEvidence!.founderMarketFit;
  fixture.team!.subScoreEvidence!.complementarity!.evidenceState='partial';
  fixture.team!.subScoreEvidence!.trackRecord!.evidenceIds=[];
  fixture.team!.subScores.commitment=5;
  const result=await run();
  expect(result.team!.subScores).toEqual({founderMarketFit:null,complementarity:2,trackRecord:null,execution:4,commitment:null});
  expect(result.dimensions.find(d=>d.id==='team')).toMatchObject({score0to5:2,evidenceState:'partial'});
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
  expect(result.dimensions.find(d=>d.id==='team')!.score0to5).toBeNull();expect(result.totalScore).toBe(67);
});

it('returns validated results before the hard job deadline instead of losing them to worker timeout',async()=>{
  const previous=mocks.call.getMockImplementation()!;const clock=vi.spyOn(Date,'now');const start=Date.now();
  try{
    mocks.call.mockImplementation(async(config,request)=>{const response=await previous(config,request);if(request.system.includes('Extract company identity'))clock.mockReturnValue(start+8*60_000);return response;});
    const result=await run();expect(result.mode).toBe('partial_error');expect(result.company!.name).toBe(fixture.company!.name);
    expect(result.dimensions.find(d=>d.id==='product_technology')!.score0to5).not.toBeNull();expect(result.limitations.join(' ')).toContain('analysis_time_budget_exceeded');
  }finally{clock.mockRestore();}
});

it.each([undefined,420000])('uses one separate PDF understanding budget (%s) without reducing the analysis allowance',async budget=>{
  snapshot.pdfUnderstandingTimeoutMs=budget;snapshot.models[0].timeoutMs=120000;
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  // Keep scoring evidence bound to the PDF even when the website returns no text.
  mocks.pdf.mockResolvedValue({evidence:fixture.evidence.map(e=>({...e,type:'uploaded_deck',url:null,documentId:'deck',page:1})),limitations:[]});
  const previous=mocks.call.getMockImplementation()!,clock=vi.spyOn(Date,'now');let now=Date.now();const start=now;
  clock.mockImplementation(()=>now);
  try{
    mocks.website.mockImplementation(async()=>{now+=60000;return {evidence:[],limitations:[]};});
    mocks.call.mockImplementation(async(config,request)=>{
      const duration=request.system.includes('Extract company identity')?(budget?360000:240000):120000;
      if(config.timeoutMs<duration)throw Object.assign(new Error('timeout'),{code:'timeout'});
      now+=duration;return previous(config,request);
    });
    const result=await run({uploadId:'deck',website:'https://public.example.org'});
    expect(result.mode).toBe('standard');expect(result.productAndTechnology).toEqual(fixture.productAndTechnology);
    expect(result.execution.elapsedMs).toBe(budget?660000:540000);expect(now-start).toBe(budget?660000:540000);
  }finally{clock.mockRestore();}
});

it('shares the PDF deadline with format correction and reports exhaustion without replaying a timeout',async()=>{
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');snapshot.pdfUnderstandingTimeoutMs=60000;
  const clock=vi.spyOn(Date,'now');let now=Date.now();clock.mockImplementation(()=>now);
  const budgets:number[]=[];
  try{
    mocks.call.mockImplementation(async config=>{
      budgets.push(config.timeoutMs);
      if(budgets.length===1){now+=45000;return {text:'{}',elapsedMs:45000,usage:null};}
      now+=15000;throw Object.assign(new Error('private upstream detail'),{code:'timeout'});
    });
    const result=await run({uploadId:'deck'});
    expect(budgets).toEqual([60000,15000]);expect(result.mode).toBe('failed');
    expect(result.limitations.join(' ')).toContain('pdf_understanding_time_budget_exceeded');
    expect(JSON.stringify(result)).not.toContain('private upstream detail');
  }finally{clock.mockRestore();}
});

it('keeps PDF enrichment calls on the normal model timeout after the initial understanding pass',async()=>{
  fixture.company!.website='https://public.example.org';writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');
  mocks.pdf.mockResolvedValue({evidence:fixture.evidence.map(e=>({...e,type:'uploaded_deck',url:null,documentId:'deck',page:1,quoteOrSummary:e.quoteOrSummary+' https://public.example.org'})),limitations:[]});
  mocks.website.mockResolvedValue({evidence:[{...fixture.evidence[0],id:'public-site',quoteOrSummary:fixture.company!.name!}],limitations:[]});
  const previous=mocks.call.getMockImplementation()!;let passes=0;
  mocks.call.mockImplementation(async(config,request)=>{
    if(request.system.includes('Extract company identity')&&++passes===2){
      expect(config.timeoutMs).toBe(10000);throw Object.assign(new Error('timeout'),{code:'timeout'});
    }
    return previous(config,request);
  });
  const result=await run({uploadId:'deck'});
  expect(passes).toBe(2);expect(result.mode).toBe('standard');expect(result.limitations.join(' ')).toContain('identity_enrichment_failed (timeout)');
});

it('honors cancellation during the independently budgeted PDF understanding pass',async()=>{
  writeFileSync(join(store.uploadsDir,'deck'),'%PDF-fixture');const controller=new AbortController();
  mocks.call.mockImplementation(async()=>{controller.abort();throw new Error('cancelled');});
  await expect(executeScreening(store,{id:'job',input:JSON.stringify({uploadId:'deck'})},snapshot,()=>{},controller.signal)).rejects.toThrow();
  expect(existsSync(join(store.uploadsDir,'deck'))).toBe(false);
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

it('retains earlier dimensions when synthesis repeats a scoring dimension',async()=>{
  const previous=mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation(async(config,request)=>{
    const response=await previous(config,request);
    if(!request.system.includes('Extract company identity')&&!request.system.includes('Independently screen only')){
      const report=JSON.parse(response.text);report.dimensions[2]={...report.dimensions[1],score0to5:1};response.text=JSON.stringify(report);
    }
    return response;
  });
  const result=await run();
  expect(result.mode).toBe('partial_error');
  expect(result.dimensions).toHaveLength(6);
  expect(result.dimensions.find(d=>d.id==='product_technology')!.score0to5).toBe(4);
  expect(result.limitations.join(' ')).toContain('synthesis_module_failed (invalid_dimensions)');
});

it('removes private PDF bytes before provider analysis and restores extracted evidence after reopening the store',async()=>{
  const input={website:'https://public.example.org',uploadId:'deck'};
  const path=join(store.uploadsDir,'deck');writeFileSync(path,'%PDF-fixture');
  store.db.prepare('UPDATE screening_jobs SET input=? WHERE id=?').run(JSON.stringify(input),'job');
  const previous=mocks.call.getMockImplementation()!;
  let privateBytesObserved=false;
  mocks.call.mockImplementation(async(config,request)=>{
    privateBytesObserved ||= existsSync(path);
    return previous(config,request);
  });
  const first=await run(input);
  expect(privateBytesObserved).toBe(false);
  expect(first.evidence.some(e=>e.id==='private')).toBe(true);
  expect(existsSync(path)).toBe(false);
  store.close();store=new Store(dir,'cd'.repeat(32));
  const recovered=store.db.prepare('SELECT * FROM screening_jobs WHERE id=?').get('job');
  const result=await executeScreening(store,recovered,snapshot,()=>{},new AbortController().signal);
  expect(result.mode).toBe('standard');
  expect(result.evidence).toEqual(first.evidence);
  expect(result.limitations.join(' ')).not.toContain('pdf_read_failed');
});

it('still removes private PDF bytes if the first cleanup attempt fails',async()=>{
  const path=join(store.uploadsDir,'deck');writeFileSync(path,'%PDF-fixture');
  const cleanup=vi.spyOn(store,'deleteUpload').mockImplementationOnce(()=>{throw new Error('transient cleanup failure');});
  try{
    const result=await run({uploadId:'deck'});
    expect(result.mode).toBe('failed');
    expect(existsSync(path)).toBe(false);
  }finally{cleanup.mockRestore();}
});
