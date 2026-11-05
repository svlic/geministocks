import { it,expect } from 'vitest';
import { matchPolicy } from './policy-matcher';
import type { PolicyConfig } from '../../shared/screening-schema';
const rule=(id:string,kind:any,priority:number)=>({id,name:id,kind,priority,sectorTags:['coding-agent'],definition:'Developer code modification',conditions:'',enabled:true,notes:''});
const p:PolicyConfig={version:'v2',prompt:'',rules:[rule('exclude','hard_exclude',2),rule('exception','exception',3)]};
it('requires precise classification, evidence, confidence and server rules; higher priority exception wins',()=>{
  expect(matchPolicy(p,{ruleIds:['exclude'],confidence:.84,evidenceIds:['e'],ambiguous:false},.85).status).toBe('unknown');
  expect(matchPolicy(p,{ruleIds:['exclude'],confidence:.99,evidenceIds:['e'],ambiguous:true},.85).status).toBe('unknown');
  expect(matchPolicy(p,{ruleIds:['exclude','exception'],confidence:.99,evidenceIds:['e'],ambiguous:false},.85).status).toBe('focus');
  expect(matchPolicy({...p,rules:[rule('exclude','hard_exclude',4),rule('exception','exception',3)]},{ruleIds:['exclude','exception'],confidence:.99,evidenceIds:['e'],ambiguous:false},.85).status).toBe('hard_exclude');
  expect(matchPolicy(p,{ruleIds:['invented'],confidence:1,evidenceIds:[],ambiguous:false},.85).status).toBe('unknown');
});
