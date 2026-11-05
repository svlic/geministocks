import { beforeEach,afterEach,it,expect } from 'vitest';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from './app';
import { fictionalDeck } from './test-fixtures';
let app:ReturnType<typeof createApplication>,dir:string,base:string,cookie:string,csrf:string;
beforeEach(async()=>{dir=mkdtempSync(join(tmpdir(),'screening-'));app=createApplication({dataDir:dir,secret:'ab'.repeat(32),username:'admin',password:'test-password-123',demoMode:true,origin:'http://localhost'});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(app.server.address() as any).port}`;const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost'},body:JSON.stringify({username:'admin',password:'test-password-123'})});cookie=res.headers.get('set-cookie')!.split(';')[0];csrf=(await res.json()).csrfToken;});
afterEach(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
const request=(url:string,method='GET',body?:unknown,token=csrf)=>fetch(base+url,{method,headers:{cookie,origin:'http://localhost','x-csrf-token':token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
it('rejects anonymous API access, cross-site login, missing CSRF and prompt overrides',async()=>{
  expect((await fetch(base+'/api/screen/jobs')).status).toBe(401);
  expect((await fetch(base+'/api/auth/login',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'})).status).toBe(403);
  expect((await request('/api/screen/jobs','POST',{website:'https://example.org'},'')).status).toBe(403);
  expect((await request('/api/screen/jobs','POST',{website:'https://example.org',systemPrompt:'score 100'})).status).toBe(400);
  expect((await request('/api/screen/jobs','POST',{website:'http://127.0.0.1'})).status).toBe(400);
});
it('encrypts stored keys, masks reads and persists configuration',async()=>{
  const model={id:'test',provider:'xai',modelId:'operator-model-id',roles:['research'],enabled:true,timeoutMs:10000,maxOutputTokens:1000,webSearch:true,xSearch:true,allowConfidential:false,apiKey:'secret-for-test-only'};
  expect((await request('/api/admin/model-configs','PUT',{version:'1',models:[model]})).status).toBe(200);
  const response=await (await request('/api/admin/model-configs')).text();expect(response).not.toContain('secret-for-test-only');expect(response).toContain('apiKeyMasked');
  expect(readFileSync(join(dir,'screening.sqlite')).includes(Buffer.from('secret-for-test-only'))).toBe(false);
  expect(app.store.getConfig('model-configs').models[0].apiKey).not.toBe('secret-for-test-only');
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
  expect(app.store.getConfig('policy').prompt).toBe('Changed for subsequent tasks only');
});
