import { screeningResultSchema, teamKeys, type ScreeningResult, type ResearchClaim, type ComparableCompany, type TeamScreening, type Evidence, type CompanyIdentity } from '../../shared/screening-schema';

/** A same-name search result is not proof of employment or identity. */
export function validateTeamIdentity(team:TeamScreening,evidence:Evidence[],company:CompanyIdentity|null):TeamScreening {
  team.founders=team.founders.filter(f=>evidence.some(e=>['official_website','uploaded_deck','official_social'].includes(e.type)&&e.quoteOrSummary.includes(f.name)));
  for(const founder of team.founders){
    founder.professionalFacts=founder.professionalFacts.filter(f=>f.evidenceIds.some(id=>{
      const e=evidence.find(e=>e.id===id);if(!e||!e.quoteOrSummary.includes(founder.name))return false;
      return ['official_website','uploaded_deck','official_social'].includes(e.type)||!!company?.name&&e.quoteOrSummary.includes(company.name);
    }));
    if(!founder.professionalFacts.length)founder.keyUnknowns.push('同名履历未完成身份消歧 / Same-name professional profile not linked to this company');
  }
  const professionalIds=new Set(team.founders.flatMap(f=>f.professionalFacts.flatMap(f=>f.evidenceIds)));
  teamKeys.forEach(key=>{
    const assessment=team.subScoreEvidence?.[key];
    if(!assessment||assessment.evidenceState!=='sufficient'||!assessment.evidenceIds.length||assessment.evidenceIds.some(id=>!professionalIds.has(id)))team.subScores[key]=null;
  });
  if(!team.founders.some(f=>f.professionalFacts.length)||!teamKeys.some(key=>team.subScores[key]!==null)){
    team.status='insufficient_evidence';teamKeys.forEach(k=>team.subScores[k]=null);team.strengths=[];team.weaknessesOrRisks=[];team.requiredMaterials=['团队介绍与可核实成果 / Team introduction and verifiable contribution evidence'];
  }
  return team;
}

/** Only the server's retrieved evidence ledger may be cited by generated fields. */
export function validateEvidence(result:ScreeningResult):ScreeningResult {
  const r=screeningResultSchema.parse(result);
  const ledger=new Map(r.evidence.map(e=>[e.id,e]));
  if(ledger.size!==r.evidence.length)throw new Error('Duplicate evidence IDs');
  const refs=(ids:string[])=>{if(ids.some(id=>!ledger.has(id)))throw new Error('Unknown evidence reference');return ids;};
  const claim=(c:ResearchClaim)=>{
    refs(c.evidenceIds);
    if(!c.evidenceIds.length&&c.verification!=='inference')c.verification='unverified';
    if(c.verification==='verified'&&c.evidenceIds.every(id=>['official_website','uploaded_deck','official_social'].includes(ledger.get(id)!.type)))c.verification='company_claim';
  };
  [...r.sectorAndPositioning,...r.productAndTechnology,...r.majorStrengths,...r.majorRisks,...(r.team?.strengths??[]),...(r.team?.weaknessesOrRisks??[]),...(r.team?.founders.flatMap(f=>f.professionalFacts)??[])].forEach(claim);
  Object.values(r.team?.subScoreEvidence??{}).forEach(assessment=>{if(assessment)refs(assessment.evidenceIds);});
  r.dimensions.forEach(d=>{refs(d.evidenceIds);if(!d.evidenceIds.length){d.score0to5=null;d.evidenceState='insufficient';}});
  refs(r.policyMatch.evidenceIds);
  const comps=(items:ComparableCompany[],category:ComparableCompany['category'])=>items.forEach(c=>{
    if(c.category!==category)throw new Error('Mixed comparable categories');
    refs(c.evidenceIds);
    if(category==='direct_private'&&(!c.sectorFit||!c.productFit||!c.customerFit||!c.evidenceIds.length))throw new Error('Direct comparable lacks fit evidence');
    const seen=new Set<string>();
    c.financing=c.financing.filter(f=>{refs(f.evidenceIds);if(!f.evidenceIds.length){f.amount=null;f.valuation=null;f.investors=[];f.verification='unverified';}if(f.valuation===null)f.valuationBasis='not_disclosed';const key=JSON.stringify([f.date,f.round,f.amount,f.currency]);if(seen.has(key))return false;seen.add(key);return true;});
    if(c.publicMarketData){refs(c.publicMarketData.evidenceIds);if(!c.publicMarketData.metricAsOf||!c.publicMarketData.evidenceIds.length){c.publicMarketData.revenueGrowth=null;c.publicMarketData.grossMargin=null;c.publicMarketData.valuationMultiple=null;}}
  });
  comps(r.directPrivateComps,'direct_private');comps(r.adjacentCompetitors,'adjacent');comps(r.publicCompanyRefs,'public_reference');
  return r;
}
