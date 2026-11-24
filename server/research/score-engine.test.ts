import { describe,it,expect } from 'vitest';
import { calculateScores, teamScore } from './score-engine';
import { defaultScoring, dimensionIds, scoringSchema, type DimensionScore } from '../../shared/screening-schema';
const dims = (scores:(number|null)[]):DimensionScore[] => dimensionIds.map((id,i)=>({id,score0to5:scores[i],weightPercent:999,rationale:'Fact',evidenceIds:['e1'],evidenceState:scores[i]===null?'insufficient':'sufficient'}));
describe('evidence weighted quality scoring',()=>{
  it('normalizes available dimensions without turning missing dimensions into zero',()=>{
    const r=calculateScores(dims([4,null,3,null,null,null]),'seed',defaultScoring);
    expect(r.evidenceCoverage).toBe(.45); expect(r.totalScore).toBe(73); expect(r.dimensions[1].score0to5).toBeNull();
  });
  it('normalizes supported weights without requiring every core dimension',()=>{
    // (4/5×30 + 3/5×20 + 2/5×15 + 5/5×20) / 85 × 100 = 72.94
    expect(calculateScores(dims([4,3,2,5,null,null]),'seed',defaultScoring)).toMatchObject({evidenceCoverage:.85,totalScore:73});
    expect(calculateScores(dims([4,3,2,null,5,null]),'seed',defaultScoring)).toMatchObject({evidenceCoverage:.75,totalScore:69});
    expect(calculateScores(dims([null,3,2,5,4,5]),'series_a_plus',defaultScoring)).toMatchObject({evidenceCoverage:.8,totalScore:78});
  });
  it('includes partial evidence with a conservative cap and uses early-stage weights for unknown',()=>{
    const input=dims([5,4,3,2,1,0]); input[0].evidenceState='partial';
    const r=calculateScores(input,'unknown',defaultScoring);
    expect(r.evidenceCoverage).toBe(1); expect(r.totalScore).toBe(48); expect(r.dimensions[0]).toMatchObject({weightPercent:35,score0to5:2,evidenceState:'partial'});
  });
  it('withholds totals only below the configured coverage boundary and never fills unsupported scores',()=>{
    const input=dims([null,null,null,null,1.5,null]);input[4].evidenceState='partial';
    expect(calculateScores(input,'pre_seed',defaultScoring)).toMatchObject({evidenceCoverage:.05,totalScore:30});
    const weights={...defaultScoring.weights,pre_seed:[36,25,15,10,4,10]};
    expect(calculateScores(input,'pre_seed',{...defaultScoring,weights})).toMatchObject({evidenceCoverage:.04,totalScore:null});
    expect(calculateScores(dims([null,null,null,null,null,null]),'seed',defaultScoring)).toMatchObject({evidenceCoverage:0,totalScore:null});
    expect(calculateScores(input,'pre_seed',{...defaultScoring,coverageThreshold:.75}).totalScore).toBeNull();
    input[4].evidenceIds=[];
    const r=calculateScores(input,'seed',defaultScoring);
    expect(r.totalScore).toBeNull();expect(r.dimensions[4].score0to5).toBeNull();
  });
  it('rejects invalid configuration and scores, aggregates team in the 10:8:7:5:5 ratio',()=>{
    expect(()=>scoringSchema.parse({...defaultScoring,weights:{...defaultScoring.weights,seed:[30,20,15,20,10,4]}})).toThrow();
    expect(()=>calculateScores(dims([6,3,2,1,0,1]),'seed',defaultScoring)).toThrow();
    expect(teamScore({founderMarketFit:5,complementarity:0,trackRecord:null,execution:null,commitment:null})).toBeCloseTo(50/18);
    expect(teamScore({founderMarketFit:null,complementarity:null,trackRecord:null,execution:null,commitment:null})).toBeNull();
  });
});
