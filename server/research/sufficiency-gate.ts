import type { CompanyIdentity,DimensionScore,ResultMode } from '../../shared/screening-schema';
export function sufficiencyGate(company:CompanyIdentity|null,dimensions:DimensionScore[]):ResultMode {
  const supported=dimensions.some(d=>d.evidenceState!=='insufficient'&&d.evidenceIds.length);
  return company&&company.identityConfidence>=.85&&company.name&&company.productSummary&&supported?'standard':'brief_insufficient';
}
