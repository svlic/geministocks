import { it,expect } from 'vitest';
import { sufficiencyGate } from './sufficiency-gate';
import { demoFixture } from './fixtures';
it('requires a clear company/product identity but permits one partial dimension before scoring',()=>{
  const r=demoFixture('job','standard');expect(sufficiencyGate(r.company,r.dimensions)).toBe('standard');
  expect(sufficiencyGate({...r.company!,identityConfidence:.84},r.dimensions)).toBe('brief_insufficient');
  expect(sufficiencyGate({...r.company!,identityConfidence:.85},r.dimensions)).toBe('standard');
  const partial=[{...r.dimensions[1],score0to5:null,evidenceState:'partial' as const}];
  expect(sufficiencyGate({...r.company!,targetCustomers:[]},partial)).toBe('standard');
  expect(sufficiencyGate(r.company,[{...partial[0],evidenceIds:[]}])).toBe('brief_insufficient');
  expect(sufficiencyGate(r.company,[{...partial[0],evidenceState:'insufficient'}])).toBe('brief_insufficient');
  expect(sufficiencyGate(null,[])).toBe('brief_insufficient');
});
