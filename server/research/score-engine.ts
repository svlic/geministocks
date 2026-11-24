import { dimensionIds, dimensionSchema, scoringSchema, teamKeys, type Stage, type ScoringConfig, type DimensionScore, type TeamScreening, type PolicyMatch } from '../../shared/screening-schema';

/** Policy affects research priority only, never dimension scores or evidence coverage. */
export function calculatePriorityScore(totalScore:number|null,policy:PolicyMatch|null) {
  if(totalScore===null||policy===null||policy.status==='hard_exclude')return {policyBonus:0,priorityScore:null};
  const policyBonus=policy.status==='focus'&&policy.evidenceIds.length>0?5:0;
  return {policyBonus,priorityScore:Math.min(100,totalScore+policyBonus)};
}

export function teamScore(scores:TeamScreening['subScores']):number|null {
  const weights=[10,8,7,5,5]; let total=0,covered=0;
  teamKeys.forEach((key,i)=>{ const n=scores[key]; if(n!==null){if(!Number.isFinite(n)||n<0||n>5)throw new Error('Invalid team score');total+=n*weights[i];covered+=weights[i];} });
  return covered ? total/covered : null;
}
export function calculateScores(input:DimensionScore[],stage:Stage,config:ScoringConfig) {
  scoringSchema.parse(config);
  if(new Set(input.map(d=>d.id)).size!==input.length)throw new Error('Duplicate scoring dimension');
  const weights=config.weights[stage==='unknown'?'pre_seed':stage];
  const dimensions=dimensionIds.map((id,i)=>{
    const d=input.find(d=>d.id===id)??{id,score0to5:null,rationale:'Insufficient evidence',evidenceIds:[],evidenceState:'insufficient'};
    // Model weights are never trusted; the backend supplies the stage snapshot.
    const valid=dimensionSchema.parse({...d,weightPercent:weights[i]});
    if(valid.evidenceState==='insufficient'||!valid.evidenceIds.length)valid.score0to5=null;
    else if(valid.evidenceState==='partial'&&valid.score0to5!==null)valid.score0to5=Math.min(valid.score0to5,2);
    return valid;
  });
  const scored=dimensions.filter(d=>d.score0to5!==null);
  const coverage=scored.reduce((s,d)=>s+d.weightPercent,0);
  const eligible=coverage>0&&coverage>=config.coverageThreshold*100;
  return {dimensions,evidenceCoverage:coverage/100,totalScore:eligible?Math.round(100*scored.reduce((s,d)=>s+d.score0to5!/5*d.weightPercent,0)/coverage):null};
}
