import { it,expect } from 'vitest';
import { validateEvidence } from './evidence';
import { demoFixture } from './fixtures';
import type { ComparableCompany } from '../../shared/screening-schema';
const comp=(category:ComparableCompany['category']='direct_private'):ComparableCompany=>({name:'Fictional comp',website:null,category,sectorFit:'Same workflow',productFit:'Same product positioning',customerFit:'Same customer',notableDifferences:[],financing:[{date:'2026-01-01',round:'Seed',amount:5000000,currency:'USD',valuation:null,valuationBasis:'not_disclosed',investors:[],evidenceIds:['demo-web'],verification:'company_claim'}],evidenceIds:['demo-web']});
it('does not upgrade company claims, infer undisclosed valuations, or duplicate a financing event',()=>{
  const r=demoFixture('job','standard');r.majorStrengths[0].verification='verified';r.directPrivateComps=[comp()];r.directPrivateComps[0].financing.push({...r.directPrivateComps[0].financing[0]});
  const validated=validateEvidence(r);expect(validated.majorStrengths[0].verification).toBe('company_claim');expect(validated.directPrivateComps[0].financing).toHaveLength(1);expect(validated.directPrivateComps[0].financing[0].valuation).toBeNull();
});
it('allows exactly zero or two direct matches, never mixes public or adjacent categories',()=>{
  const r=demoFixture('job','standard');expect(validateEvidence(r).directPrivateComps).toEqual([]);
  r.directPrivateComps=[comp(),{...comp(),name:'Second fixture'}];expect(validateEvidence(r).directPrivateComps).toHaveLength(2);
  r.directPrivateComps=[comp('adjacent')];expect(()=>validateEvidence(r)).toThrow('Mixed comparable');
  r.directPrivateComps=[comp('public_reference')];expect(()=>validateEvidence(r)).toThrow('Mixed comparable');
});
it('rejects unbound references and nulls unsupported public metrics',()=>{
  const r=demoFixture('job','standard');r.majorStrengths[0].evidenceIds=['invented'];expect(()=>validateEvidence(r)).toThrow('Unknown evidence');
  r.majorStrengths=[];r.publicCompanyRefs=[{...comp('public_reference'),publicMarketData:{ticker:'DEMO',metricAsOf:null,revenueGrowth:20,grossMargin:40,valuationMultiple:100,multipleType:'EV/revenue',notes:'Only fictional segment is related; group multiples are not comparable to Seed',evidenceIds:['demo-web']}}];
  expect(validateEvidence(r).publicCompanyRefs[0].publicMarketData!.valuationMultiple).toBeNull();
});
