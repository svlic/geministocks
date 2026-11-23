import { it,expect } from 'vitest';
import { sufficiencyGate } from './sufficiency-gate';
import { demoFixture } from './fixtures';
it('requires identity, product/customer evidence and three factual dimensions independently of source availability',()=>{
  const r=demoFixture('job','standard');expect(sufficiencyGate(r.company,r.dimensions)).toBe('standard');
  expect(sufficiencyGate({...r.company!,identityConfidence:.84},r.dimensions)).toBe('brief_insufficient');
  expect(sufficiencyGate({...r.company!,identityConfidence:.85},r.dimensions)).toBe('standard');
  expect(sufficiencyGate(r.company,r.dimensions.slice(0,2))).toBe('brief_insufficient');
  expect(sufficiencyGate(null,[])).toBe('brief_insufficient');
});
