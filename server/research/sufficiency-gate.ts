import type { CompanyIdentity,DimensionScore,ResultMode } from '../../shared/screening-schema';
export function sufficiencyGate(company:CompanyIdentity|null,dimensions:DimensionScore[],technicalFailure:boolean):ResultMode {
  if(technicalFailure)return company?'partial_error':'failed';
  const supported=new Set(dimensions.filter(d=>d.evidenceState==='sufficient'&&d.score0to5!==null&&d.evidenceIds.length).map(d=>d.id));
  return company&&company.identityConfidence>=.85&&company.name&&company.productSummary&&company.targetCustomers.length&&supported.has('product_technology')&&supported.has('sector_positioning')&&(supported.has('team')||supported.has('product_technology'))&&supported.size>=3?'standard':'brief_insufficient';
}
