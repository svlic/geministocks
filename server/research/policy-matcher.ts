import type { PolicyConfig,PolicyMatch } from '../../shared/screening-schema';
export interface PolicyAssessment {ruleIds:string[];confidence:number;evidenceIds:string[];ambiguous:boolean}
export function matchPolicy(policy:PolicyConfig,assessment:PolicyAssessment,threshold:number):PolicyMatch {
  const base:PolicyMatch={status:'unknown',matchedRuleIds:[],policyVersion:policy.version,confidence:assessment.confidence,explanation:'No unambiguous evidence-backed rule match / 无明确、有证据支持的规则匹配',evidenceIds:assessment.evidenceIds};
  if(assessment.ambiguous||!assessment.evidenceIds.length)return base;
  const rules=policy.rules.filter(r=>r.enabled&&assessment.ruleIds.includes(r.id)).sort((a,b)=>b.priority-a.priority);
  // Ambiguous equal-priority hard/exception conflicts never automatically exclude.
  const hard=rules.find(r=>r.kind==='hard_exclude'),exception=rules.find(r=>r.kind==='exception');
  if(hard&&exception&&hard.priority===exception.priority)return base;
  const chosen=rules[0];if(!chosen)return base;
  if(chosen.kind==='hard_exclude'&&assessment.confidence<threshold)return base;
  return {...base,status:chosen.kind==='exception'?'focus':chosen.kind,matchedRuleIds:rules.map(r=>r.id),explanation:`${chosen.name}: ${chosen.definition}`};
}
