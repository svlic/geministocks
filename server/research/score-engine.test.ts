import { describe,it,expect } from 'vitest';
import { calculateScores, teamScore } from './score-engine';
import { defaultScoring, dimensionIds, scoringSchema, type DimensionScore } from '../../shared/screening-schema';
const dims = (scores:(number|null)[]):DimensionScore[] => dimensionIds.map((id,i)=>({id,score0to5:scores[i],weightPercent:999,rationale:'Fact',evidenceIds:['e1'],evidenceState:scores[i]===null?'insufficient':'sufficient'}));
describe('evidence weighted quality scoring',()=>{
  it('does not turn missing dimensions into zero or publish a low-coverage total',()=>{
    const r=calculateScores(dims([4,null,3,null,null,null]),'seed',defaultScoring);
    expect(r.evidenceCoverage).toBe(.45); expect(r.totalScore).toBeNull(); expect(r.dimensions[1].score0to5).toBeNull();
  });
  it('normalizes sufficient weights, includes the threshold, and requires all three core dimensions',()=>{
    // (4/5×30 + 3/5×20 + 2/5×15 + 5/5×20) / 85 × 100 = 72.94
    expect(calculateScores(dims([4,3,2,5,null,null]),'seed',defaultScoring)).toMatchObject({evidenceCoverage:.85,totalScore:73});
    expect(calculateScores(dims([4,3,2,null,5,null]),'seed',defaultScoring)).toMatchObject({evidenceCoverage:.75,totalScore:69});
    expect(calculateScores(dims([null,3,2,5,4,5]),'series_a_plus',defaultScoring).totalScore).toBeNull();
  });
  it('uses early-stage weights for unknown and excludes partial evidence',()=>{
    const input=dims([5,4,3,2,1,0]); input[0].evidenceState='partial';
    const r=calculateScores(input,'unknown',defaultScoring);
    expect(r.evidenceCoverage).toBe(.65); expect(r.totalScore).toBeNull(); expect(r.dimensions[0].weightPercent).toBe(35);
  });
  it('rejects invalid configuration and scores, aggregates team in the 10:8:7:5:5 ratio',()=>{
    expect(()=>scoringSchema.parse({...defaultScoring,weights:{...defaultScoring.weights,seed:[30,20,15,20,10,4]}})).toThrow();
    expect(()=>calculateScores(dims([6,3,2,1,0,1]),'seed',defaultScoring)).toThrow();
    expect(teamScore({founderMarketFit:5,complementarity:0,trackRecord:null,execution:null,commitment:null})).toBeCloseTo(50/18);
    expect(teamScore({founderMarketFit:null,complementarity:null,trackRecord:null,execution:null,commitment:null})).toBeNull();
  });
});
