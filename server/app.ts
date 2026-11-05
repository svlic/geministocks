import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes,randomUUID } from 'node:crypto';
import { createWriteStream,createReadStream,existsSync,statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import { Store,hash,verifyPassword,passwordHash } from './persistence/store';
import { modelConfigsSchema,policySchema,scoringSchema,submissionSchema } from '../shared/screening-schema';
import { executeScreening,type Snapshot } from './research/orchestrator';
import { callModel } from './gateway/index';

interface Options {dataDir:string;secret:string;username:string;password:string;demoMode:boolean;origin:string;production?:boolean;distDir?:string}
class HttpError extends Error {constructor(readonly status:number,message:string){super(message);}}
const bad=(message:string):never=>{throw new HttpError(400,message);};
async function jsonBody(req:IncomingMessage){
  if(!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'JSON required');
  const chunks:Buffer[]=[];let size=0;for await(const b of req){size+=b.length;if(size>128*1024)throw new HttpError(413,'Request too large');chunks.push(b);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{bad('Invalid JSON');}
}
export function createApplication(options:Options) {
  const store=new Store(options.dataDir,options.secret);store.bootstrap(options.username,options.password);store.cleanup();
  // A persisted job is recovered on restart; retries are bounded, not infinite.
  store.db.prepare("UPDATE screening_jobs SET status='queued' WHERE status='running'").run();
  const buckets=new Map<string,{count:number;until:number}>();
  const dummyPassword=passwordHash(randomBytes(24).toString('hex'));
  let active:{id:string;controller:AbortController;promise?:Promise<void>}|undefined;
  const limited=(key:string,max:number,period:number)=>{const now=Date.now();for(const [k,v]of buckets)if(v.until<now)buckets.delete(k);const b=buckets.get(key)??{count:0,until:now+period};buckets.set(key,b);if(++b.count>max)throw new HttpError(429,'Rate limit exceeded');};
  const modelsView=()=>{const c=store.getConfig('model-configs');return {...c,models:c.models.map(({apiKey,...m}:any)=>({...m,apiKeyMasked:apiKey?'••••••••':''}))};};
  const deleteJobUpload=(job:any)=>{const input=JSON.parse(job.input);if(input.uploadId)store.deleteUpload(input.uploadId);};
  const runNext=async()=>{
    if(active){await active.promise;return;}
    store.cleanup();
    const job=store.db.prepare("SELECT * FROM screening_jobs WHERE status='queued' AND expires>? ORDER BY rowid LIMIT 1").get(Date.now()) as any;
    if(!job)return;
    if(job.attempts>=2){store.db.prepare("UPDATE screening_jobs SET status='failed',error='recovery_limit_exceeded' WHERE id=?").run(job.id);deleteJobUpload(job);return;}
    const controller=new AbortController();active={id:job.id,controller};
    store.db.prepare("UPDATE screening_jobs SET status='running',attempts=attempts+1 WHERE id=?").run(job.id);
    const timeout=setTimeout(()=>controller.abort(new Error('job_timeout')),10*60*1000);
    const promise=(async()=>{
      try{
        const result=await executeScreening(store,job,store.decrypt<Snapshot>(job.snapshot),p=>{controller.signal.throwIfAborted();store.db.prepare('UPDATE screening_jobs SET phase=? WHERE id=?').run(p,job.id);},controller.signal);
        store.db.prepare("UPDATE screening_jobs SET status='completed',phase='output',result=?,error=NULL WHERE id=? AND status='running'").run(JSON.stringify(result),job.id);
      }catch{
        store.db.prepare("UPDATE screening_jobs SET status='failed',error='job_execution_failed_or_timeout' WHERE id=? AND status='running'").run(job.id);
      }finally{clearTimeout(timeout);deleteJobUpload(job);active=undefined;}
    })();
    if(active)active.promise=promise;
    await promise;
  };
  const server=createServer(async(req,res)=>{
    const send=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(options.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try{
      const path=new URL(req.url??'/',options.origin).pathname;
      if(!path.startsWith('/api/')){
        if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(405,'Method not allowed');
        if(!options.distDir)throw new HttpError(404,'Use the Vite frontend server in development');
        const root=resolve(options.distDir),requested=resolve(root,'.'+decodeURIComponent(path));
        if(requested!==root&&!requested.startsWith(root+sep))throw new HttpError(404,'Not found');
        const file=existsSync(requested)&&statSync(requested).isFile()?requested:resolve(root,'index.html');
        const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'};
        res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);return;
      }
      limited(`all:${req.socket.remoteAddress}`,300,60000);
      const mutation=!['GET','HEAD'].includes(req.method??'');
      if(mutation&&req.headers.origin!==options.origin)throw new HttpError(403,'Same-origin request required');
      const sessionId=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('screen_session='))?.slice(15);
      const session=sessionId?store.db.prepare('SELECT * FROM auth_sessions WHERE id_hash=? AND expires>?').get(hash(sessionId),Date.now()) as any:null;
      const user=session?{username:session.username,role:'admin'}:null;
      if(path==='/api/auth/me'&&req.method==='GET')return send(200,{user,csrfToken:session?.csrf??'',demoMode:options.demoMode});
      if(path==='/api/auth/login'&&req.method==='POST'){
        limited(`login:${req.socket.remoteAddress}`,10,15*60000);
        const body=z.object({username:z.string().max(100),password:z.string().max(512)}).strict().parse(await jsonBody(req));
        const admin=store.db.prepare('SELECT * FROM admin_users WHERE username=?').get(body.username) as any;
        const valid=verifyPassword(body.password,admin?.password_hash??dummyPassword);
        if(!admin||!valid)throw new HttpError(401,'Invalid credentials');
        const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
        if(session)store.db.prepare('DELETE FROM auth_sessions WHERE id_hash=?').run(session.id_hash);
        store.db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run(hash(token),admin.username,csrf,Date.now()+8*3600000);
        res.setHeader('Set-Cookie',`screen_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${options.production?'; Secure':''}`);
        return send(200,{user:{username:admin.username,role:'admin'},csrfToken:csrf,demoMode:options.demoMode});
      }
      if(!session)throw new HttpError(401,'Authentication required');
      if(mutation&&req.headers['x-csrf-token']!==session.csrf)throw new HttpError(403,'Invalid CSRF token');
      if(path==='/api/auth/logout'&&req.method==='POST'){
        store.db.prepare('DELETE FROM auth_sessions WHERE id_hash=?').run(session.id_hash);res.setHeader('Set-Cookie',`screen_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${options.production?'; Secure':''}`);return send(200,{ok:true});
      }
      const configMatch=/^\/api\/admin\/(model-configs|policy|scoring)$/.exec(path);
      if(configMatch){
        const kind=configMatch[1];
        if(req.method==='GET')return send(200,kind==='model-configs'?modelsView():store.getConfig(kind));
        if(req.method==='PUT'){
          const schema=kind==='model-configs'?modelConfigsSchema:kind==='policy'?policySchema:scoringSchema;
          const config:any=schema.parse(await jsonBody(req));const previous=store.getConfig(kind);
          if(config.version!==previous.version)throw new HttpError(409,'Configuration changed; reload before saving');
          if(kind==='model-configs'){
            config.models=config.models.map((m:any)=>{
              const previousModel=previous.models.find((p:any)=>p.id===m.id);
              const {apiKeyMasked,...saved}=m;
              if(m.baseUrl){const u=new URL(m.baseUrl);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')bad('Model endpoint must use HTTPS on port 443');}
              return {...saved,apiKey:m.apiKey?store.encrypt(m.apiKey):previousModel?.apiKey};
            });
          }
          config.version=String(Number(previous.version)+1);store.setConfig(kind,config);return send(200,kind==='model-configs'?modelsView():config);
        }
      }
      if(path==='/api/admin/model-configs/test'&&req.method==='POST'){
        limited(`model-test:${user!.username}`,10,3600000);
        const {id}=z.object({id:z.string()}).strict().parse(await jsonBody(req));const config=store.getConfig('model-configs').models.find((m:any)=>m.id===id);
        if(!config?.apiKey)bad('Model key not configured');
        try{const check=await callModel({...config,apiKey:store.decrypt<string>(config.apiKey)},{system:'Return a brief response. When tools are enabled, use them and cite the public x.ai website.',input:'Check public x.ai product documentation.',search:config.provider==='xai'&&(config.webSearch||config.xSearch),maxTurns:1});return send(200,{ok:true,message:'Model responded; tool flags report observed calls, not configured capability',searchUsed:check.searchUsed,xSearchUsed:check.xSearchUsed,usage:check.usage});}catch(e){return send(200,{ok:false,code:(e as any).code??'provider_error',message:'Model authentication, permissions, tools or network check failed'});}
      }
      if(path==='/api/uploads/init'&&req.method==='POST'){
        limited(`upload:${user!.username}`,30,3600000);
        const body=z.object({filename:z.string().max(200).regex(/\.pdf$/i),size:z.number().int().positive().max(25*1024*1024),mime:z.literal('application/pdf')}).strict().parse(await jsonBody(req));
        const id=randomUUID();store.db.prepare('INSERT INTO uploads(id,owner,size,expires) VALUES (?,?,?,?)').run(id,user!.username,body.size,Date.now()+3600000);
        return send(201,{uploadId:id,uploadUrl:`/api/uploads/${id}`});
      }
      const upload=/^\/api\/uploads\/([a-f0-9-]{36})$/.exec(path);
      if(upload&&req.method==='PUT'){
        const row=store.db.prepare('SELECT * FROM uploads WHERE id=? AND owner=? AND expires>? AND ready=0').get(upload[1],user!.username,Date.now()) as any;
        if(!row)throw new HttpError(404,'Upload not found or already used');
        if(req.headers['content-type']!=='application/pdf')throw new HttpError(415,'PDF required');
        // Claim before the first await so duplicate PUTs cannot delete an in-flight file.
        store.db.prepare('UPDATE uploads SET ready=-1 WHERE id=?').run(row.id);
        let size=0,magic=Buffer.alloc(0);
        try{
          const limit=new Transform({transform(chunk,_,cb){size+=chunk.length;if(size>row.size||size>25*1024*1024)return cb(new HttpError(413,'PDF size limit exceeded'));if(magic.length<5)magic=Buffer.concat([magic,chunk]).subarray(0,5);cb(null,chunk);}});
          await pipeline(req,limit,createWriteStream(resolve(store.uploadsDir,row.id),{flags:'wx',mode:0o600}));
          if(size!==row.size||magic.toString()!=='%PDF-')bad('Invalid PDF signature or size');
          store.db.prepare('UPDATE uploads SET ready=1 WHERE id=?').run(row.id);return send(200,{ok:true});
        }catch(e){store.deleteUpload(row.id);throw e;}
      }
      if(path==='/api/screen/jobs'&&req.method==='POST'){
        limited(`jobs:${user!.username}`,20,3600000);const input=submissionSchema.parse(await jsonBody(req));
        if(!options.demoMode&&input.demoScenario)bad('Demo fixtures disabled in live mode');
        if(input.website){const {assertPublicUrl}=await import('./ingestion/index');await assertPublicUrl(input.website);}
        if((store.db.prepare("SELECT count(*) AS n FROM screening_jobs WHERE owner=? AND status IN ('queued','running')").get(user!.username) as any).n>=4)throw new HttpError(429,'Too many pending jobs');
        if(input.uploadId){const upload=store.db.prepare('SELECT * FROM uploads WHERE id=? AND owner=? AND ready=1 AND expires>?').get(input.uploadId,user!.username,Date.now());if(!upload)bad('PDF not uploaded or already assigned');}
        const id=randomUUID(),snapshot:Snapshot={models:store.getConfig('model-configs').models,policy:store.getConfig('policy'),scoring:store.getConfig('scoring'),demoMode:options.demoMode};
        store.db.exec('BEGIN IMMEDIATE');try{store.db.prepare('INSERT INTO screening_jobs(id,owner,status,phase,input,snapshot,expires) VALUES (?,?,?,?,?,?,?)').run(id,user!.username,'queued','reading',JSON.stringify(input),store.encrypt(snapshot),Date.now()+86400000);if(input.uploadId)store.db.prepare('UPDATE uploads SET ready=2 WHERE id=?').run(input.uploadId);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
        return send(202,{id,status:'queued',phase:'reading'});
      }
      const jobPath=/^\/api\/screen\/jobs\/([a-f0-9-]{36})(?:\/(result|cancel))?$/.exec(path);
      if(jobPath){
        const job=store.db.prepare('SELECT * FROM screening_jobs WHERE id=? AND owner=? AND expires>?').get(jobPath[1],user!.username,Date.now()) as any;
        if(!job)throw new HttpError(404,'Job not found or expired');
        if(jobPath[2]==='result'&&req.method==='GET'){if(!job.result)throw new HttpError(409,'Result not ready');return send(200,JSON.parse(job.result));}
        if(jobPath[2]==='cancel'&&req.method==='POST'){
          store.db.prepare("UPDATE screening_jobs SET status='cancelled',error=NULL WHERE id=? AND status IN ('queued','running')").run(job.id);if(active&&active.id===job.id)active.controller.abort();deleteJobUpload(job);return send(200,{ok:true});
        }
        if(!jobPath[2]&&req.method==='GET')return send(200,{id:job.id,status:job.status,phase:job.phase,...(job.status==='failed'?{error:job.error}:{})});
      }
      throw new HttpError(404,'Not found');
    }catch(error){
      if(res.destroyed||res.headersSent)return;
      if(error instanceof HttpError)return send(error.status,{error:error.message});
      if(error instanceof z.ZodError)return send(400,{error:'Invalid fields or configuration; check required values and limits'});
      // Never echo upstream errors, URLs containing credentials, prompts or secrets.
      return send(400,{error:'Request rejected or unavailable; check input, source security and service configuration'});
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  let timer:ReturnType<typeof setInterval>|undefined;
  return {server,store,runNext,startWorker(){timer=setInterval(()=>void runNext().catch(()=>{}),500);},async close(){if(timer)clearInterval(timer);active?.controller.abort();await active?.promise;await new Promise<void>((r)=>server.close(()=>r()));store.close();}};
}
