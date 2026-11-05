import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, chmodSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { defaultScoring } from '../../shared/screening-schema';

export const hash = (s:string) => createHash('sha256').update(s).digest('hex');
export function passwordHash(password:string) { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
export function verifyPassword(password:string,encoded:string) { const [salt,key]=encoded.split(':');const calculated=scryptSync(password,salt,64);const expected=Buffer.from(key,'hex');return expected.length===calculated.length&&timingSafeEqual(expected,calculated); }
export class Store {
  db:DatabaseSync;
  uploadsDir:string;
  private key:Buffer;
  constructor(readonly dataDir:string, secret:string) {
    if(Buffer.from(secret,'hex').length!==32||!/^[0-9a-f]{64}$/i.test(secret))throw new Error('CONFIG_ENCRYPTION_KEY must be 64 hex characters');
    this.key=Buffer.from(secret,'hex');
    mkdirSync(dataDir,{recursive:true,mode:0o700});chmodSync(dataDir,0o700);
    this.uploadsDir=resolve(dataDir,'uploads');mkdirSync(this.uploadsDir,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(resolve(dataDir,'screening.sqlite'));
    chmodSync(resolve(dataDir,'screening.sqlite'),0o600);
    this.db.exec(readFileSync(new URL('./001_initial.sql',import.meta.url),'utf8'));
    this.db.exec('PRAGMA secure_delete = ON;');
    this.db.prepare('INSERT OR IGNORE INTO configs VALUES (?,?)').run('scoring',JSON.stringify(defaultScoring));
    this.db.prepare('INSERT OR IGNORE INTO configs VALUES (?,?)').run('policy',JSON.stringify({version:'1',prompt:'',rules:[]}));
    this.db.prepare('INSERT OR IGNORE INTO configs VALUES (?,?)').run('model-configs',JSON.stringify({version:'1',models:[]}));
  }
  encrypt(value:unknown) { const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64'); }
  decrypt<T=any>(value:string):T { const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString()); }
  getConfig(kind:string):any { return JSON.parse((this.db.prepare('SELECT value FROM configs WHERE kind=?').get(kind) as any).value); }
  setConfig(kind:string,value:unknown) { this.db.prepare('UPDATE configs SET value=? WHERE kind=?').run(JSON.stringify(value),kind); }
  bootstrap(username:string,password:string) { if(!username||password.length<12)throw new Error('Admin username and password (12+ characters) required');this.db.prepare('INSERT OR IGNORE INTO admin_users VALUES (?,?)').run(username,passwordHash(password)); }
  cleanup(now=Date.now()) {
    const uploads=this.db.prepare('SELECT id FROM uploads WHERE expires<=?').all(now) as {id:string}[];
    for(const {id} of uploads)rmSync(resolve(this.uploadsDir,id),{force:true});
    this.db.prepare('DELETE FROM uploads WHERE expires<=?').run(now);
    this.db.prepare('DELETE FROM screening_jobs WHERE expires<=?').run(now);
    this.db.prepare('DELETE FROM auth_sessions WHERE expires<=?').run(now);
    const valid=new Set((this.db.prepare('SELECT id FROM uploads').all() as {id:string}[]).map(r=>r.id));
    for(const name of readdirSync(this.uploadsDir))if(!valid.has(name))rmSync(resolve(this.uploadsDir,name),{force:true});
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  }
  deleteUpload(id:string) { rmSync(resolve(this.uploadsDir,id),{force:true});this.db.prepare('DELETE FROM uploads WHERE id=?').run(id); }
  close(){this.db.close();}
}
