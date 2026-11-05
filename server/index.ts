import { resolve } from 'node:path';
import { createApplication } from './app';

const production=process.env.NODE_ENV==='production';
const origin=process.env.APP_ORIGIN??'http://localhost:3000';
if(production&&!origin.startsWith('https://'))throw new Error('Production APP_ORIGIN must use HTTPS');
const app=createApplication({
  dataDir:resolve(process.env.DATA_DIR??'.screening-data'),secret:process.env.CONFIG_ENCRYPTION_KEY??'',
  username:process.env.ADMIN_USERNAME??'admin',password:process.env.ADMIN_PASSWORD??'',demoMode:process.env.DEMO_MODE==='true',origin,production,
  distDir:production?resolve('dist'):undefined,
});
app.server.listen(Number(process.env.PORT??3001),process.env.HOST??'127.0.0.1',()=>{app.startWorker();console.info('Screening service listening; demo mode:',process.env.DEMO_MODE==='true');});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
