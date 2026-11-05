import { it,expect } from 'vitest';
import { sufficiencyGate } from './sufficiency-gate';
import { demoFixture } from './fixtures';
it('requires identity, product/customer evidence and three factual dimensions; failures stay technical',()=>{
  const r=demoFixture('job','standard');expect(sufficiencyGate(r.company,r.dimensions,false)).toBe('standard');
  expect(sufficiencyGate({...r.company!,identityConfidence:.84},r.dimensions,false)).toBe('brief_insufficient');
  expect(sufficiencyGate(r.company,r.dimensions.slice(0,2),false)).toBe('brief_insufficient');
  expect(sufficiencyGate(r.company,r.dimensions,true)).toBe('partial_error');expect(sufficiencyGate(null,[],true)).toBe('failed');
});
