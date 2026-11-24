import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app';
import { fictionalDeck } from './test-fixtures';
import * as orchestrator from './research/orchestrator';
let app:ReturnType<typeof createApplication>,dir:string,base:string,cookie:string,csrf:string;
beforeEach(async()=>{dir=mkdtempSync(join(tmpdir(),'screening-'));app=createApplication({dataDir:dir,secret:'ab'.repeat(32),username:'admin',password:'test-password-123',demoMode:true,origin:'http://localhost'});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(app.server.address() as any).port}`;const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost'},body:JSON.stringify({username:'admin',password:'test-password-123'})});cookie=res.headers.get('set-cookie')!.split(';')[0];csrf=(await res.json()).csrfToken;});
afterEach(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
const request=(url:string,method='GET',body?:unknown,token=csrf)=>fetch(base+url,{method,headers:{cookie,origin:'http://localhost','x-csrf-token':token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
it.each(['http://screening.test','https://screening.test'])('supports login and logout for browser origin %s behind an HTTP backend',async(origin)=>{
  await app.close();
  app=createApplication({dataDir:dir,secret:'ab'.repeat(32),username:'admin',password:'test-password-123',demoMode:true,origin});
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
  base=`http://127.0.0.1:${(app.server.address() as any).port}`;
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'test-password-123'})});
  expect(login.status).toBe(200);
  const setCookie=login.headers.get('set-cookie')!;
  expect(setCookie).toContain('; HttpOnly; SameSite=Strict;');
  expect(setCookie.includes('; Secure')).toBe(origin.startsWith('https:'));
  expect(login.headers.has('strict-transport-security')).toBe(false);
  cookie=setCookie.split(';')[0];csrf=(await login.json()).csrfToken;
  const me=await fetch(base+'/api/auth/me',{headers:{cookie}});
  expect((await me.json()).user.username).toBe('admin');
  const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie,origin,'x-csrf-token':csrf}});
  expect(logout.status).toBe(200);
  expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  expect(logout.headers.get('set-cookie')!.includes('; Secure')).toBe(origin.startsWith('https:'));
  expect((await (await fetch(base+'/api/auth/me',{headers:{cookie}})).json()).user).toBeNull();
});
it.each([undefined,'https://other.test'])('accepts login and mutations with Origin %s while requiring CSRF',async(origin)=>{
  const headers:Record<string,string>={'content-type':'application/json'};
  if(origin)headers.origin=origin;
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({username:'admin',password:'test-password-123'})});
  expect(login.status).toBe(200);
  headers.cookie=login.headers.get('set-cookie')!.split(';')[0];
  const token=(await login.json()).csrfToken;
  expect((await fetch(base+'/api/auth/logout',{method:'POST',headers})).status).toBe(403);
  headers['x-csrf-token']=token;
  expect((await fetch(base+'/api/auth/logout',{method:'POST',headers})).status).toBe(200);
  expect((await (await fetch(base+'/api/auth/me',{headers})).json()).user).toBeNull();
});
it('rejects anonymous API access, missing CSRF and prompt overrides',async()=>{
  expect((await fetch(base+'/api/screen/jobs')).status).toBe(401);
  expect((await request('/api/screen/jobs','POST',{website:'https://example.org'},'')).status).toBe(403);
  expect((await request('/api/screen/jobs','POST',{website:'https://example.org',systemPrompt:'score 100'})).status).toBe(400);
  expect((await request('/api/screen/jobs','POST',{website:'http://127.0.0.1'})).status).toBe(400);
});
it('encrypts stored keys, masks reads and persists configuration',async()=>{
  const model={id:'test',provider:'openai',modelId:'operator-model-id',roles:['research'],enabled:true,timeoutMs:600000,maxOutputTokens:1000,allowConfidential:false,apiKey:'secret-for-test-only'};
  expect((await request('/api/admin/model-configs','PUT',{version:'1',models:[model]})).status).toBe(200);
  const response=await (await request('/api/admin/model-configs')).text();expect(response).not.toContain('secret-for-test-only');expect(response).toContain('apiKeyMasked');
  expect(JSON.parse(response).models[0].timeoutMs).toBe(600000);
  for(const timeoutMs of [999,600001])expect((await request('/api/admin/model-configs','PUT',{version:'2',models:[{...model,timeoutMs}]})).status).toBe(400);
  expect((await (await request('/api/admin/model-configs')).json()).models[0].timeoutMs).toBe(600000);
  expect(readFileSync(join(dir,'screening.sqlite')).includes(Buffer.from('secret-for-test-only'))).toBe(false);
  expect(app.store.getConfig('model-configs').models[0].apiKey).not.toBe('secret-for-test-only');
});
it('defaults and snapshots the PDF understanding budget without changing existing jobs',async()=>{
  const initial=await (await request('/api/admin/model-configs')).json();expect(initial.pdfUnderstandingTimeoutMs).toBe(300000);
  const first=await (await request('/api/screen/jobs','POST',{website:'https://example.org'})).json();
  for(const value of [0,59999,600001])expect((await request('/api/admin/model-configs','PUT',{...initial,pdfUnderstandingTimeoutMs:value})).status).toBe(400);
  const saved=await request('/api/admin/model-configs','PUT',{...initial,pdfUnderstandingTimeoutMs:420000});expect(saved.status).toBe(200);
  expect((await saved.json()).pdfUnderstandingTimeoutMs).toBe(420000);
  const second=await (await request('/api/screen/jobs','POST',{website:'https://example.org'})).json();
  const snapshot=(id:string)=>app.store.decrypt((app.store.db.prepare('SELECT snapshot FROM screening_jobs WHERE id=?').get(id) as any).snapshot);
  expect(snapshot(first.id).pdfUnderstandingTimeoutMs).toBe(300000);expect(snapshot(second.id).pdfUnderstandingTimeoutMs).toBe(420000);
  expect((await request('/api/screen/jobs','POST',{website:'https://example.org',pdfUnderstandingTimeoutMs:600000})).status).toBe(400);
});

it('excludes actual PDF understanding time from the worker hard deadline without resetting earlier elapsed time',async()=>{
  const {id}=await (await request('/api/screen/jobs','POST',{website:'https://example.org'})).json();
  const execute=vi.spyOn(orchestrator,'executeScreening').mockImplementation(async(_store,_job,_snapshot,phase,signal)=>{
    await new Promise(r=>setTimeout(r,60000));
    phase('understanding');await new Promise(r=>setTimeout(r,240000));phase('identity');
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  });
  vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout']});
  try{
    const running=app.runNext();
    await vi.advanceTimersByTimeAsync(60000);
    expect((app.store.db.prepare('SELECT phase FROM screening_jobs WHERE id=?').get(id) as any).phase).toBe('understanding');
    await vi.advanceTimersByTimeAsync(240000+539999);
    expect((app.store.db.prepare('SELECT status FROM screening_jobs WHERE id=?').get(id) as any).status).toBe('running');
    await vi.advanceTimersByTimeAsync(1);await running;
    expect((app.store.db.prepare('SELECT status FROM screening_jobs WHERE id=?').get(id) as any).status).toBe('failed');
  }finally{execute.mockRestore();vi.useRealTimers();}
});

it('accepts transient website DNS failures but still rejects unsafe addresses at submission',async()=>{
  const ingestion=await import('./ingestion/index');
  const check=vi.spyOn(ingestion,'assertPublicUrl').mockRejectedValueOnce(new ingestion.IngestionError('site_network_error','transient')).mockRejectedValueOnce(new ingestion.IngestionError('unsafe_address','private'));
  try{
    expect((await request('/api/screen/jobs','POST',{website:'https://public.example.org'})).status).toBe(202);
    expect((await request('/api/screen/jobs','POST',{website:'https://public.example.org'})).status).toBe(400);
  }finally{check.mockRestore();}
});
it('migrates legacy settings once, preserves secrets and snapshots, and requires explicit re-enabling of native models',async()=>{
  const apiKey=app.store.encrypt('legacy-test-secret');
  const common={modelId:'legacy-model',roles:['research'],enabled:true,timeoutMs:10000,maxOutputTokens:1000,allowConfidential:false,apiKey,webSearch:true,xSearch:true};
  const legacy={version:'4',models:[{...common,id:'native',provider:'xai'},{...common,id:'compatible',provider:'openai',baseUrl:'https://compatible.example/v1'}]};
  app.store.setConfig('model-configs',legacy);
  app.store.setConfig('scoring',{...app.store.getConfig('scoring'),version:'1',researchTurns:3,teamTurns:2});
  const job=await (await request('/api/screen/jobs','POST',{website:'https://example.org'})).json();
  const before=app.store.db.prepare('SELECT snapshot FROM screening_jobs WHERE id=?').get(job.id) as any;
  const reopen=async()=>{
    await app.close();app=createApplication({dataDir:dir,secret:'ab'.repeat(32),username:'admin',password:'test-password-123',demoMode:true,origin:'http://localhost'});
    await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(app.server.address() as any).port}`;
  };
  await reopen();
  const migrated=await (await request('/api/admin/model-configs')).json();
  expect(migrated.version).toBe('5');
  expect(migrated.models[0]).toMatchObject({provider:'openai',baseUrl:'https://api.x.ai/v1',enabled:false});
  expect(migrated.models[1]).toMatchObject({provider:'openai',baseUrl:'https://compatible.example/v1',enabled:true});
  expect(migrated.models.every((m:any)=>!('webSearch' in m)&&!('xSearch' in m)&&!('apiKey' in m))).toBe(true);
  expect(app.store.decrypt(app.store.getConfig('model-configs').models[0].apiKey)).toBe('legacy-test-secret');
  expect(app.store.db.prepare('SELECT snapshot FROM screening_jobs WHERE id=?').get(job.id)).toEqual(before);
  const scoring=await (await request('/api/admin/scoring')).json();
  expect(scoring.version).toBe('2');expect(scoring).not.toHaveProperty('researchTurns');expect(scoring).not.toHaveProperty('teamTurns');
  await reopen();expect((await (await request('/api/admin/model-configs')).json()).version).toBe('5');
  expect((await request('/api/admin/model-configs','PUT',{version:'5',models:legacy.models.map(({webSearch,xSearch,apiKey,...m})=>m)})).status).toBe(400);
});
it.each([
  ['1',.75,'2',.05],
  ['4',.9,'4',.9],
  ['3',.75,'3',.75],
] as const)('upgrades only the untouched default coverage threshold (%s, %s) without rewriting jobs',async(version,coverageThreshold,nextVersion,nextThreshold)=>{
  app.store.setConfig('scoring',{...app.store.getConfig('scoring'),version,coverageThreshold});
  const {id}=await (await request('/api/screen/jobs','POST',{website:'https://example.org'})).json();await app.runNext();
  const before=app.store.db.prepare('SELECT snapshot,result FROM screening_jobs WHERE id=?').get(id);
  for(let i=0;i<2;i++){
    await app.close();app=createApplication({dataDir:dir,secret:'ab'.repeat(32),username:'admin',password:'test-password-123',demoMode:true,origin:'http://localhost'});
    await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(app.server.address() as any).port}`;
    expect(await (await request('/api/admin/scoring')).json()).toMatchObject({version:nextVersion,coverageThreshold:nextThreshold});
    expect(app.store.db.prepare('SELECT snapshot,result FROM screening_jobs WHERE id=?').get(id)).toEqual(before);
  }
  const next=await (await request('/api/screen/jobs','POST',{website:'https://example.org'})).json();
  const row=app.store.db.prepare('SELECT snapshot FROM screening_jobs WHERE id=?').get(next.id) as any;
  expect(app.store.decrypt(row.snapshot).scoring.coverageThreshold).toBe(nextThreshold);
});
it('executes four explicit demo modes with no fabricated live-search claims and no user follow-up state',async()=>{
  for(const [scenario,mode] of [['standard','standard'],['insufficient','brief_insufficient'],['policy','brief_policy'],['failure','failed']]){
    const res=await request('/api/screen/jobs','POST',{website:'https://example.org',stage:'unknown',demoScenario:scenario});expect(res.status).toBe(202);const {id}=await res.json();await app.runNext();
    const report=await (await request(`/api/screen/jobs/${id}/result`)).json();expect(report.mode).toBe(mode);expect(report.execution.searchUsed).toBe(false);expect(report.execution.provider).toBe('demo-fixture');
    if(mode!=='standard')expect(report.totalScore).toBeNull();else expect(report.dimensions[0].weightPercent).toBe(30);
  }
});
it('cancels persisted jobs, prevents attachment reuse and expires temporary data',async()=>{
  const job=await (await request('/api/screen/jobs','POST',{website:'https://example.org'})).json();expect((await request(`/api/screen/jobs/${job.id}/cancel`,'POST',{})).status).toBe(200);await app.runNext();expect((await (await request(`/api/screen/jobs/${job.id}`)).json()).status).toBe('cancelled');
  app.store.cleanup(Date.now()+86400001);
  expect(app.store.db.prepare('SELECT id FROM screening_jobs WHERE id=?').get(job.id)).toBeUndefined();
  expect((await request(`/api/screen/jobs/${job.id}`)).status).toBe(401);
});

it('streams a private ten-page PDF and forbids public reads or reassignment',async()=>{
  const pdf=fictionalDeck();
  const init=await (await request('/api/uploads/init','POST',{filename:'fictional-demo.pdf',size:pdf.length,mime:'application/pdf'})).json();
  expect((await fetch(base+init.uploadUrl)).status).toBe(401);
  const upload=()=>fetch(base+init.uploadUrl,{method:'PUT',headers:{cookie,origin:'http://localhost','x-csrf-token':csrf,'content-type':'application/pdf'},body:pdf});
  const uploaded=await Promise.all([upload(),upload()]);expect(uploaded.map(r=>r.status).sort()).toEqual([200,404]);
  const submission={uploadId:init.uploadId,stage:'unknown',demoScenario:'standard'};
  const res=await request('/api/screen/jobs','POST',submission);expect(res.status).toBe(202);const {id}=await res.json();
  expect((await request('/api/screen/jobs','POST',submission)).status).toBe(400);
  await app.runNext();const result=await (await request(`/api/screen/jobs/${id}/result`)).json();expect(result.mode).toBe('standard');
  expect(result.evidence.filter((e:any)=>e.type==='uploaded_deck').map((e:any)=>e.page)).toEqual([1,2,3,4,5,6,7,8,9,10]);
  expect(app.store.db.prepare('SELECT * FROM uploads WHERE id=?').get(init.uploadId)).toBeUndefined();
});

it('accepts a 25 MiB direct stream, rejects oversize metadata and damaged PDF signatures',async()=>{
  expect((await request('/api/uploads/init','POST',{filename:'too-big.pdf',size:25*1024*1024+1,mime:'application/pdf'})).status).toBe(400);
  const pdf=Buffer.alloc(25*1024*1024,32);fictionalDeck(1).copy(pdf);
  const init=await (await request('/api/uploads/init','POST',{filename:'large-fixture.pdf',size:pdf.length,mime:'application/pdf'})).json();
  expect((await fetch(base+init.uploadUrl,{method:'PUT',headers:{cookie,origin:'http://localhost','x-csrf-token':csrf,'content-type':'application/pdf'},body:pdf})).status).toBe(200);
  expect(readFileSync(join(dir,'uploads',init.uploadId)).length).toBe(25*1024*1024);
  const damaged=await (await request('/api/uploads/init','POST',{filename:'bad.pdf',size:5,mime:'application/pdf'})).json();
  expect((await fetch(base+damaged.uploadUrl,{method:'PUT',headers:{cookie,origin:'http://localhost','x-csrf-token':csrf,'content-type':'application/pdf'},body:'HELLO'})).status).toBe(400);
});

it('recovers a persisted interrupted job and its original policy snapshot after restart',async()=>{
  const {id}=await (await request('/api/screen/jobs','POST',{website:'https://example.org',demoScenario:'standard'})).json();
  app.store.db.prepare("UPDATE screening_jobs SET status='running',attempts=1 WHERE id=?").run(id);
  const policy=await (await request('/api/admin/policy')).json();expect((await request('/api/admin/policy','PUT',{...policy,prompt:'Changed for subsequent tasks only'})).status).toBe(200);
  await app.close();app=createApplication({dataDir:dir,secret:'ab'.repeat(32),username:'admin',password:'test-password-123',demoMode:true,origin:'http://localhost'});
  await app.runNext();const row=app.store.db.prepare('SELECT * FROM screening_jobs WHERE id=?').get(id) as any;
  expect(row.status).toBe('completed');expect(row.attempts).toBe(2);expect(app.store.decrypt(row.snapshot).policy.prompt).toBe('');
  expect(app.store.decrypt(row.snapshot)).not.toHaveProperty('searchApiKey');
  expect(app.store.getConfig('policy').prompt).toBe('Changed for subsequent tasks only');
});
