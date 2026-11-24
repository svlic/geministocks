import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { companySchema, dimensionSchema, claimSchema, comparableSchema, teamSchema, teamKeys, screeningResultSchema, pdfUnderstandingTimeoutSchema, type ModelConfig, type ScreeningResult, type Evidence, type ScoringConfig, type PolicyConfig } from '../../shared/screening-schema';
import { callModel } from '../gateway/index';
import { ingestWebsite,extractPdf } from '../ingestion/index';
import { Store } from '../persistence/store';
import { demoFixture } from './fixtures';
import { calculateScores, calculatePriorityScore, teamScore } from './score-engine';
import { validateEvidence,validateTeamIdentity } from './evidence';
import { matchPolicy } from './policy-matcher';
import { sufficiencyGate } from './sufficiency-gate';
import { SYSTEM_BOUNDARY,TEAM_PROMPT,SECTOR_PROMPT } from './prompts';
import { parseModelJson } from '../../utils/jsonUtils';
import { discoverPublicEvidence } from './public-search';

export interface Snapshot {models:ModelConfig[];policy:PolicyConfig;scoring:ScoringConfig;demoMode:boolean;pdfUnderstandingTimeoutMs?:number}
const entitySchema=z.object({company:companySchema.nullable(),dimensions:z.array(dimensionSchema).max(6),missingMaterials:z.array(z.string()).max(5)}).strict();
const policyAssessmentSchema=z.object({assessment:z.object({ruleIds:z.array(z.string()),confidence:z.number().min(0).max(1),evidenceIds:z.array(z.string()),ambiguous:z.boolean()}).strict().nullable()}).strict();
const reportSchema=z.object({summary:z.string().max(6000),sectorAndPositioning:z.array(claimSchema).max(20),productAndTechnology:z.array(claimSchema).max(20),directPrivateComps:z.array(comparableSchema).max(5),adjacentCompetitors:z.array(comparableSchema).max(5),publicCompanyRefs:z.array(comparableSchema).max(5),majorStrengths:z.array(claimSchema).max(5),majorRisks:z.array(claimSchema).max(5),missingMaterials:z.array(z.string()).max(5),dimensions:z.array(dimensionSchema).max(6)}).strict();
const sourceLimitCodes=['invalid_pdf','pdf_too_large','pdf_page_limit','unsafe_url','unsafe_address','cross_hostname','robots_disallowed','robots_unavailable','robots_crawl_delay','site_http_error','site_read_limit','site_encoding','response_too_large','redirect_limit'];
const dimensionMaterials={team:'团队介绍与可核实成果 / Team introduction and verifiable contribution evidence',product_technology:'产品功能、技术方案与差异化依据 / Product capabilities, technical approach and differentiation evidence',sector_positioning:'目标客户、使用场景与替代方案 / Target customers, workflows and alternatives',traction_pmf:'产品使用、客户反馈与验证进展 / Product usage, customer feedback and validation progress',business_economics:'商业模式、定价与成本依据 / Business model, pricing and cost evidence',capital_efficiency:'资金使用、现金消耗与里程碑依据 / Capital use, cash burn and milestone evidence'};

export async function executeScreening(store:Store,job:any,snapshot:Snapshot,phase:(p:string)=>void,signal:AbortSignal):Promise<ScreeningResult> {
  const started=Date.now(),input=JSON.parse(job.input);
  const ledger:Evidence[]=[],limitations:string[]=[];
  let calls=0;
  const issues:NonNullable<ScreeningResult['issues']>=[];
  let understandingElapsedMs=0,understandingDeadline:number|undefined;
  const metrics={provider:'unconfigured',modelId:'unconfigured',searchUsed:false,xSearchUsed:false,elapsedMs:0};
  const result:ScreeningResult={schemaVersion:'1.0',jobId:job.id,mode:'failed',generatedAt:new Date().toISOString(),company:null,policyMatch:null,summary:'分析未完成 / Analysis incomplete',team:null,dimensions:[],evidenceCoverage:0,totalScore:null,sectorAndPositioning:[],productAndTechnology:[],directPrivateComps:[],adjacentCompetitors:[],publicCompanyRefs:[],majorStrengths:[],majorRisks:[],missingMaterials:[],evidence:ledger,limitations,issues,execution:metrics};
  const log=(module:string,value:unknown)=>store.db.prepare('INSERT INTO job_usage VALUES (?,?,?)').run(job.id,module,JSON.stringify(value));
  const model=(role:'research'|'team'|'synthesis')=>{
    const c=snapshot.models.find(m=>m.enabled&&m.roles.includes(role));
    if(!c||!c.apiKey)throw new Error(`model_not_configured:${role}`);
    return {...c,apiKey:store.decrypt<string>(c.apiKey)};
  };
  const failureCode=(error:unknown)=>{
    if(error instanceof z.ZodError)return 'invalid_structure';
    if(error instanceof Error&&/^model_not_configured:(research|team|synthesis)$/.test(error.message))return error.message;
    if(error instanceof Error&&['analysis_time_budget_exceeded','pdf_understanding_time_budget_exceeded','model_call_budget_exceeded'].includes(error.message))return error.message;
    if(error instanceof Error&&['Unknown evidence reference','Duplicate evidence IDs','Mixed comparable categories','Direct comparable lacks fit evidence'].includes(error.message))return 'invalid_evidence';
    if(error instanceof Error&&error.message==='Duplicate scoring dimension')return 'invalid_dimensions';
    if(error instanceof Error&&['Invalid structured model answer','Empty model answer'].includes(error.message))return 'invalid_json';
    const code=(error as {code?:unknown})?.code;
    return typeof code==='string'&&[...sourceLimitCodes,'invalid_config','authentication','permission','model_not_found','unsupported_request','rate_limit','unavailable','network','timeout','invalid_response','incomplete','pdf_timeout','pdf_parse_failed','pdf_output_limit','pdf_parser_unavailable','site_timeout','site_network_error'].includes(code)?code:'module_error';
  };
  const recordFailure=(module:NonNullable<ScreeningResult['issues']>[number]['module'],error:unknown)=>{
    const code=failureCode(error);
    const kind=sourceLimitCodes.includes(code)?'source_limit'
      :['invalid_structure','invalid_evidence','invalid_dimensions','invalid_json','invalid_response','incomplete'].includes(code)?'invalid_output'
      :code.startsWith('model_not_configured:')||['invalid_config','authentication','permission','model_not_found','unsupported_request'].includes(code)?'configuration'
      :code==='module_error'?'unknown_failure':'execution_failure';
    const issue:NonNullable<ScreeningResult['issues']>[number]={module,kind,code};
    issues.push(issue);return issue;
  };
  // Validate each module before publishing it, so rejected output cannot erase earlier work.
  const accept=(patch:Partial<ScreeningResult>)=>{
    const valid=validateEvidence({...result,...patch,evidence:ledger,limitations});
    if(valid.dimensions.length)calculateScores(valid.dimensions,valid.company?.stage??'unknown',snapshot.scoring);
    Object.assign(result,valid,{evidence:ledger,limitations,issues,execution:metrics});
  };
  const finish=()=>{
    metrics.elapsedMs=Date.now()-started;phase('scoring');
    const valid=validateEvidence({...result,issues});
    if(valid.dimensions.length)Object.assign(valid,calculateScores(valid.dimensions,valid.company?.stage??'unknown',snapshot.scoring));
    if(valid.team?.status==='insufficient_evidence')valid.missingMaterials=[...new Set([...valid.missingMaterials,...valid.team.requiredMaterials])];
    if(valid.mode==='standard'||valid.mode==='brief_insufficient'){
      const missing=valid.dimensions.filter(d=>d.evidenceState==='insufficient'&&(d.id!=='team'||valid.team?.status==='insufficient_evidence')).map(d=>dimensionMaterials[d.id]);
      if(!valid.company?.name||!valid.company.productSummary||valid.company.identityConfidence<.85)missing.unshift('可确认公司身份的名称、官网与产品介绍 / Company name, website and product description establishing identity');
      valid.missingMaterials=[...new Set([...valid.missingMaterials,...missing])];
    }
    valid.execution.elapsedMs=Date.now()-started;
    if(valid.mode==='standard'||valid.mode==='brief_insufficient')valid.mode=sufficiencyGate(valid.company,valid.dimensions)==='standard'&&valid.totalScore!==null?'standard':'brief_insufficient';
    if((valid.mode!=='standard'&&valid.mode!=='partial_error')||sufficiencyGate(valid.company,valid.dimensions)!=='standard')valid.totalScore=null;
    Object.assign(valid,calculatePriorityScore(valid.totalScore,valid.policyMatch));
    phase('output');return screeningResultSchema.parse(valid);
  };
  const structured=async<T>(role:'research'|'team'|'synthesis',schema:z.ZodType<T>,instructions:string,data:unknown)=>{
    signal.throwIfAborted();if(++calls>7)throw new Error('model_call_budget_exceeded');
    const c=model(role);metrics.provider=c.provider;metrics.modelId=c.modelId;
    const system=`${SYSTEM_BOUNDARY}\n${instructions}\nJSON Schema: ${JSON.stringify(z.toJSONSchema(schema))}`;
    for(let attempt=0;attempt<2;attempt++){
      // PDF understanding (including correction) has one separate deadline, not the role timeout.
      // Other calls retain the eight-minute budget and two-minute worker safety margin.
      const understanding=understandingDeadline!==undefined;
      const remaining=understandingDeadline===undefined
        ?8*60_000-(Date.now()-started-understandingElapsedMs)
        :understandingDeadline-Date.now();
      if(remaining<=0)throw new Error(understanding?'pdf_understanding_time_budget_exceeded':'analysis_time_budget_exceeded');
      let payload;
      try{
        payload=await callModel({...c,timeoutMs:understanding?remaining:Math.min(c.timeoutMs,remaining)},{system:system+(attempt?'\nThe previous completed answer did not match the schema. Return a complete schema-conforming JSON object using only the supplied evidence.':''),input:JSON.stringify({untrustedData:data}),signal});
      }catch(error){
        if(understanding&&(error as {code?:string})?.code==='timeout')throw new Error('pdf_understanding_time_budget_exceeded');
        throw error;
      }
      log(role,{elapsedMs:payload.elapsedMs,usage:payload.usage});
      try{return schema.parse(parseModelJson(payload.text));}
      catch(error){if(attempt||calls>=7)throw error;signal.throwIfAborted();calls++;}
    }
    throw new Error('invalid_structured_output');
  };
  phase('reading');
  try {
    if(input.uploadId){
      try{
        const pdf=job.ingestion_cache?store.decrypt<{evidence:Evidence[];limitations:string[]}>(job.ingestion_cache):await extractPdf(await readFile(resolve(store.uploadsDir,input.uploadId)),input.uploadId,signal);
        // Checkpoint extraction before deleting the raw PDF so restart recovery can continue.
        store.db.prepare('UPDATE screening_jobs SET ingestion_cache=? WHERE id=?').run(store.encrypt(pdf),job.id);
        ledger.push(...pdf.evidence as Evidence[]);limitations.push(...pdf.limitations);
        if(!pdf.evidence.length&&pdf.limitations.some(l=>l.startsWith('pdf_page_read_failed:')))recordFailure('pdf',{code:'pdf_parse_failed'});
      }catch(error){
        signal.throwIfAborted();
        if(snapshot.demoMode)throw error;
        limitations.push(`pdf_read_failed (${recordFailure('pdf',error).code}): PDF 读取未完成，继续使用其他来源 / PDF unavailable; other sources remain usable`);
      }finally{store.deleteUpload(input.uploadId);}
    }
    if(snapshot.demoMode){
      // Uploaded files still undergo actual parser validation; never pretend fixture text was extracted.
      phase('identity');phase('policy');phase('research');
      const demo=demoFixture(job.id,input.demoScenario??'standard');
      demo.evidence.push(...ledger);demo.limitations.push(...limitations);Object.assign(result,demo);return finish();
    }
    const discover=async(website:string)=>{
      try{
        signal.throwIfAborted();if(++calls>7)throw new Error('model_call_budget_exceeded');
        const remaining=8*60_000-(Date.now()-started-understandingElapsedMs);
        if(remaining<=0)throw new Error('analysis_time_budget_exceeded');
        const c=model('research');metrics.provider=c.provider;metrics.modelId=c.modelId;
        const budget=AbortSignal.any([signal,AbortSignal.timeout(remaining)]);
        const search=await discoverPublicEvidence(new URL(website).origin,{...c,timeoutMs:Math.min(c.timeoutMs,remaining)},budget);
        log('public-search',{elapsedMs:search.elapsedMs,usage:search.usage});
        metrics.searchUsed ||= search.searchUsed;
        metrics.xSearchUsed ||= search.xSearchUsed;
        for(const e of search.evidence)if(!ledger.some(existing=>existing.url===e.url))ledger.push(e);
        limitations.push(...search.limitations);
      }catch(error){signal.throwIfAborted();limitations.push(`public_search_failed (${recordFailure('public_search',error).code}): 公开搜索未完成，继续使用已读取材料 / Public search unavailable; using retrieved material`);}
    };
    if(input.website){
      try{const site=await ingestWebsite(input.website,signal);ledger.push(...site.evidence as Evidence[]);limitations.push(...site.limitations);}
      catch(error){signal.throwIfAborted();limitations.push(`website_read_failed (${recordFailure('website',error).code}): 官网读取失败，继续使用其他来源 / Website unavailable; other sources remain usable`);}
      await discover(input.website);
    }
    // If any downstream role disallows confidential data, omit it everywhere, including
    // derived company/team summaries. This prevents indirect disclosure across providers.
    const allowDeck=(['research','team','synthesis'] as const).every(role=>snapshot.models.find(m=>m.enabled&&m.roles.includes(role))?.allowConfidential===true);
    const permitted=()=>ledger.filter(e=>e.type!=='uploaded_deck'||allowDeck).map(e=>({...e,quoteOrSummary:e.quoteOrSummary.slice(0,6000)}));
    const deckOmitted=ledger.some(e=>e.type==='uploaded_deck')&&!allowDeck;
    if(deckOmitted){
      limitations.push('confidential_processing_disabled: 角色未获机密处理授权，PDF 不进入模型；不代表材料缺失 / Deck omitted from all model calls because a role lacks permission; not missing material');
      issues.push({module:'analysis',kind:'configuration',code:'confidential_processing_disabled'});
    }
    if(!permitted().length){
      result.mode=issues.some(issue=>issue.kind!=='source_limit')?'failed':'brief_insufficient';
      result.summary=issues.length?'来源读取或搜索未完成，当前没有可用于分析的材料；原因见执行限制，不能据此认定公司没有相关信息。需提供可读取且获准处理的材料 / Source retrieval or search was incomplete. No usable text is available; see execution limitations. This does not prove the company lacks information. Readable, permitted material is needed.':'当前没有获准且可读取的分析文本；空白、少字或图片页不属于技术异常 / No permitted readable text is currently available; blank, sparse or image-only pages are not technical failures';
      result.missingMaterials=['可读取的公司、产品和目标客户介绍 / Readable company, product and target-customer information'];
      if(deckOmitted){result.summary='PDF 已读取，但角色未获机密处理授权，未进行模型分析；需管理员调整授权或改用公开材料，不代表公司信息不足 / PDF text was retrieved but confidential processing is not permitted. Adjust administrator permissions or use public material; this is not evidence of missing company information.';result.missingMaterials=[];}
      return finish();
    }
    const extract=()=>structured('research',entitySchema,'Extract company identity and evidence-supported dimensions. Identity confidence <.85 if ambiguous. Stage must be unknown unless specifically evidenced. Notes are unverified context only.',{evidence:permitted(),note:input.note,stageHint:input.stage});
    const applyEntity=(entity:z.infer<typeof entitySchema>)=>accept({company:entity.company,dimensions:entity.dimensions,missingMaterials:entity.missingMaterials});
    let entity:z.infer<typeof entitySchema>;
    if(permitted().some(e=>e.type==='uploaded_deck')){
      const budget=pdfUnderstandingTimeoutSchema.parse(snapshot.pdfUnderstandingTimeoutMs),understandingStarted=Date.now();
      understandingDeadline=understandingStarted+budget;phase('understanding');
      try{entity=await extract();applyEntity(entity);}
      finally{
        understandingElapsedMs=Date.now()-understandingStarted;understandingDeadline=undefined;
        phase('identity');
      }
    }else{phase('identity');entity=await extract();applyEntity(entity);}
    // A Deck-supplied website is only accepted as public evidence after actually
    // fetching it and confirming the named company in public text. Never fetch
    // a model-invented URL or private Deck paths/query tokens.
    const proposedWebsite=entity.company?.website;
    if(!input.website&&proposedWebsite&&entity.company?.name&&permitted().some(e=>e.quoteOrSummary.includes(proposedWebsite))){
      try{
        const publicWebsite=new URL(proposedWebsite).origin;
        const site=await ingestWebsite(publicWebsite,signal);
        if(site.evidence.some(e=>e.quoteOrSummary.includes(entity.company!.name!))){
          input.website=publicWebsite;ledger.push(...site.evidence as Evidence[]);limitations.push(...site.limitations);
          await discover(publicWebsite);
          try{const enriched=await extract();applyEntity(enriched);entity=enriched;}
          catch(error){signal.throwIfAborted();limitations.push(`identity_enrichment_failed (${recordFailure('identity_enrichment',error).code}): 保留已确认结果 / Retaining the earlier validated identity`);}
        }else limitations.push('deck_website_identity_unconfirmed: public website did not confirm Deck identity');
      }catch(error){signal.throwIfAborted();recordFailure('identity_enrichment',error);limitations.push('deck_website_unreadable: public identity could not be confirmed; using permitted Deck evidence');}
    }
    if(snapshot.policy.rules.some(r=>r.enabled)){
      phase('policy');
      try{
        const {assessment}=await structured('research',policyAssessmentSchema,'Assess investment policy using only the administrator rules and cited evidence. Set assessment to null if no assessment can be made. Return rule IDs, confidence and ambiguity, never quality scores or final policy status.',{company:result.company,evidence:permitted(),policy:{...snapshot.policy,rules:snapshot.policy.rules.filter(r=>r.enabled)}});
        accept({policyMatch:matchPolicy(snapshot.policy,assessment,snapshot.scoring.hardExcludeConfidence)});
      }catch(error){signal.throwIfAborted();limitations.push(`policy_module_failed (${recordFailure('policy',error).code}): 策略匹配留空，继续独立质量分析 / Policy match unavailable; continuing independent quality analysis`);}
    }
    result.mode=sufficiencyGate(result.company,result.dimensions);
    if(result.policyMatch?.status==='hard_exclude'){result.mode='brief_policy';result.dimensions=[];result.missingMaterials=[];result.summary='明确命中后台策略，不代表质量差 / Explicit policy exclusion, not a quality judgment';return finish();}
    const limited=result.mode==='brief_insufficient';
    result.summary=limited?'当前证据不足以形成完整评分，以下保留可支持的事实与未知项 / Limited report: supported facts and unknowns; evidence is insufficient for full scoring':'已完成身份与初步维度分析 / Identity and preliminary dimensions completed';
    // Only the independent team module may supply the team dimension, even if extraction omitted it.
    const preliminaryTeam=result.dimensions.find(d=>d.id==='team');
    result.dimensions=[{id:'team',weightPercent:0,rationale:limited?'整体证据或公司身份尚不足，未启动独立团队评分；未评分不代表团队材料缺失 / Overall evidence or company identity is insufficient; independent team scoring was not started. This does not establish missing team material.':preliminaryTeam?.rationale??'独立团队分析尚未完成 / Independent team analysis pending',score0to5:null,evidenceIds:[],evidenceState:'insufficient'},...result.dimensions.filter(d=>d.id!=='team')];
    phase('research');
    if(!limited)try {
      const assessment=await structured('team',teamSchema.nullable(),TEAM_PROMPT,{company:result.company,evidence:permitted()});
      const team=validateTeamIdentity(assessment??teamSchema.parse({status:'insufficient_evidence',founders:[],subScores:Object.fromEntries(teamKeys.map(key=>[key,null])),strengths:[],weaknessesOrRisks:[],requiredMaterials:[]}),ledger,result.company);
      accept({team});
      const supportedTeam=team.founders.some(f=>f.professionalFacts.some(c=>c.evidenceIds.length));
      const teamDimension=result.dimensions.find(d=>d.id==='team');
      if(teamDimension){
        teamDimension.score0to5=team.status==='evaluated'&&supportedTeam?teamScore(team.subScores):null;
        const assessments=teamKeys.filter(key=>team.subScores[key]!==null).map(key=>team.subScoreEvidence![key]!);
        teamDimension.evidenceIds=[...new Set(assessments.flatMap(a=>a.evidenceIds))];
        teamDimension.evidenceState=teamDimension.score0to5===null?'insufficient':assessments.some(a=>a.evidenceState==='partial')?'partial':'sufficient';
        teamDimension.rationale=assessments.length?assessments.map(a=>a.rationale).join('\n').slice(0,6000):'当前材料及已读取的公开来源中缺少可归属的团队信息，需补充团队介绍与可核实成果；不代表团队能力不足 / Retrieved material lacks attributable team evidence. Team introduction and verifiable contributions are needed; this does not imply poor capability.';
      }
    }catch(error){signal.throwIfAborted();result.mode='partial_error';limitations.push(`team_module_failed (${recordFailure('team',error).code}): 独立团队分析未完成，其他结果保留 / Team analysis unavailable; other results retained`);result.team=null;result.dimensions=result.dimensions.map(d=>d.id==='team'?{...d,score0to5:null,evidenceState:'insufficient',rationale:'团队分析未完成，原因见执行限制；不能据此判断团队材料不足 / Team analysis incomplete; see execution limitations. This does not establish a lack of team material.'}:d);}
    try{
      const report=await structured('synthesis',reportSchema,`${SECTOR_PROMPT}\nSynthesize concise initial screening, not diligence. Use only supplied ledger IDs, never add source URLs. Keep team scoring from the independent agent unchanged.${limited?' Evidence is limited: summarize supported product/sector facts and key unknowns; do not invent missing facts or produce an overall score.':''}`,{company:result.company,team:result.team,dimensions:result.dimensions,evidence:permitted(),issues});
      // Reject duplicate updates before merging, which could exceed the six-dimension schema.
      calculateScores(report.dimensions,result.company?.stage??'unknown',snapshot.scoring);
      const teamDimension=result.dimensions.find(d=>d.id==='team');
      accept({...report,missingMaterials:[...new Set([...result.missingMaterials,...report.missingMaterials])],dimensions:[...(teamDimension?[teamDimension]:[]),...report.dimensions.filter(d=>d.id!=='team'),...result.dimensions.filter(d=>d.id!=='team'&&!report.dimensions.some(update=>update.id===d.id))]});
    }catch(error){signal.throwIfAborted();result.mode='partial_error';limitations.push(`synthesis_module_failed (${recordFailure('synthesis',error).code}): 综合模块未完成，保留已验证的身份、评分、团队及来源 / Synthesis unavailable; validated identity, dimensions, team and sources retained`);}
    return finish();
  }catch(error){
    if(signal.aborted)throw error;
    result.mode=result.company?'partial_error':'failed';result.totalScore=null;result.summary='部分分析未完成；以下仅保留已验证的结果与实际读取的来源 / Analysis incomplete; validated results and actually retrieved sources retained';limitations.push(`analysis_failed (${recordFailure('analysis',error).code}): 未编造缺失内容 / No missing content was fabricated`);
    return finish();
  }finally{if(input.uploadId)store.deleteUpload(input.uploadId);}
}
