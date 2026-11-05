import { z } from 'zod';

const text = z.string().max(6000);
const ids = z.array(z.string().min(1).max(100)).max(100);
const strings = z.array(text).max(40);
export const dimensionIds = ['team', 'product_technology', 'sector_positioning', 'traction_pmf', 'business_economics', 'capital_efficiency'] as const;
export const stageSchema = z.enum(['pre_seed', 'seed', 'series_a_plus', 'unknown']);
export type Stage = z.infer<typeof stageSchema>;
export const verificationSchema = z.enum(['verified', 'company_claim', 'unverified', 'conflicting', 'inference']);
const publicUrl = z.string().url().max(2048).refine(v => { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; });
export const evidenceSchema = z.object({
  id: z.string().min(1).max(100), type: z.enum(['official_website', 'uploaded_deck', 'official_social', 'third_party', 'financial_filing', 'other']),
  title: text, url: publicUrl.nullable(), documentId: text.nullable(), page: z.number().int().min(1).max(40).nullable(),
  publishedAt: z.string().nullable(), retrievedAt: z.string().datetime(), quoteOrSummary: z.string().max(12000),
}).strict().refine(e => e.type === 'uploaded_deck' ? !!e.documentId && e.page !== null : !!e.url, 'Evidence needs URL or document and page');
export type Evidence = z.infer<typeof evidenceSchema>;
export const claimSchema = z.object({ text, verification: verificationSchema, evidenceIds: ids }).strict();
export type ResearchClaim = z.infer<typeof claimSchema>;
export const companySchema = z.object({
  name: text.nullable(), website: publicUrl.nullable(), aliases: strings, productSummary: text.nullable(), targetCustomers: strings,
  sectorPath: strings, stage: stageSchema, stageConfidence: z.number().min(0).max(1).nullable(), identityConfidence: z.number().min(0).max(1),
}).strict();
export const dimensionSchema = z.object({ id: z.enum(dimensionIds), score0to5: z.number().min(0).max(5).nullable(), weightPercent: z.number().min(0).max(100), rationale: text, evidenceIds: ids, evidenceState: z.enum(['sufficient', 'partial', 'insufficient']) }).strict();
export type DimensionScore = z.infer<typeof dimensionSchema>;
export const teamKeys = ['founderMarketFit', 'complementarity', 'trackRecord', 'execution', 'commitment'] as const;
const subScores = z.object(Object.fromEntries(teamKeys.map(k => [k, z.number().min(0).max(5).nullable()])) as Record<typeof teamKeys[number], z.ZodNullable<z.ZodNumber>>).strict();
export const teamSchema = z.object({
  status: z.enum(['evaluated', 'insufficient_evidence', 'not_run', 'error']),
  founders: z.array(z.object({ name: text, title: text.nullable(), professionalFacts: z.array(claimSchema).max(20), keyUnknowns: strings }).strict()).max(12),
  subScores,
  subScoreEvidence: z.partialRecord(z.enum(teamKeys), z.object({rationale:text.min(1),evidenceIds:ids,evidenceState:z.enum(['sufficient','partial','insufficient'])}).strict()).optional(),
  strengths: z.array(claimSchema).max(10), weaknessesOrRisks: z.array(claimSchema).max(10), requiredMaterials: strings,
}).strict();
export const financingSchema = z.object({ date: z.string().nullable(), round: text.nullable(), amount: z.number().nonnegative().nullable(), currency: text.nullable(), valuation: z.number().nonnegative().nullable(), valuationBasis: z.enum(['pre_money', 'post_money', 'not_disclosed']).nullable(), investors: strings, evidenceIds: ids, verification: verificationSchema }).strict();
export const comparableSchema = z.object({
  name: text, website: publicUrl.nullable(), category: z.enum(['direct_private', 'adjacent', 'public_reference']), sectorFit: text, productFit: text, customerFit: text,
  notableDifferences: strings, financing: z.array(financingSchema).max(10),
  publicMarketData: z.object({ ticker: text.nullable(), metricAsOf: z.string().nullable(), revenueGrowth: z.number().nullable(), grossMargin: z.number().nullable(), valuationMultiple: z.number().nullable(), multipleType: text.nullable(), notes: text, evidenceIds: ids }).strict().optional(), evidenceIds: ids,
}).strict();
export const policyMatchSchema = z.object({status: z.enum(['focus', 'low_priority', 'hard_exclude', 'unknown']), matchedRuleIds: ids, policyVersion: text, confidence: z.number().min(0).max(1), explanation: text, evidenceIds: ids}).strict();
export const screeningResultSchema = z.object({
  schemaVersion: z.literal('1.0'), jobId: text, mode: z.enum(['standard', 'brief_insufficient', 'brief_policy', 'partial_error', 'failed']), generatedAt: z.string().datetime(), company: companySchema.nullable(), policyMatch: policyMatchSchema,
  summary: text, team: teamSchema.nullable(), dimensions: z.array(dimensionSchema).max(6), evidenceCoverage: z.number().min(0).max(1), totalScore: z.number().min(0).max(100).nullable(),
  sectorAndPositioning: z.array(claimSchema).max(20), productAndTechnology: z.array(claimSchema).max(20), directPrivateComps: z.array(comparableSchema).max(5), adjacentCompetitors: z.array(comparableSchema).max(5), publicCompanyRefs: z.array(comparableSchema).max(5),
  majorStrengths: z.array(claimSchema).max(10), majorRisks: z.array(claimSchema).max(10), missingMaterials: strings, evidence: z.array(evidenceSchema).max(100), limitations: strings,
  execution: z.object({provider: text, modelId: text, searchUsed: z.boolean(), xSearchUsed: z.boolean(), elapsedMs: z.number().nonnegative(), approximateCost: z.number().nullable().optional()}).strict(),
}).strict();
export type ScreeningResult = z.infer<typeof screeningResultSchema>;
export type TeamScreening = z.infer<typeof teamSchema>;
export type ComparableCompany = z.infer<typeof comparableSchema>;
export type PolicyMatch = z.infer<typeof policyMatchSchema>;
export type CompanyIdentity = z.infer<typeof companySchema>;
export type ResultMode = ScreeningResult['mode'];

const weightRow = z.array(z.number().min(0).max(100)).length(6).refine(w => Math.abs(w.reduce((a,b) => a+b,0)-100)<0.00001, 'Weights must sum to 100');
export const scoringSchema = z.object({ version: text, weights: z.object({ pre_seed: weightRow, seed: weightRow, series_a_plus: weightRow }).strict(), coverageThreshold: z.number().min(0.75).max(1), hardExcludeConfidence: z.number().min(0.85).max(1), researchTurns: z.number().int().min(1).max(3), teamTurns: z.number().int().min(1).max(2) }).strict();
export type ScoringConfig = z.infer<typeof scoringSchema>;
export const defaultScoring: ScoringConfig = {version:'1',weights:{pre_seed:[35,25,15,10,5,10],seed:[30,20,15,20,10,5],series_a_plus:[20,15,15,25,15,10]},coverageThreshold:0.75,hardExcludeConfidence:0.85,researchTurns:3,teamTurns:2};
export const policySchema = z.object({ version:text, prompt:z.string().max(12000), rules:z.array(z.object({id:z.string().min(1).max(100), name:text, kind:z.enum(['hard_exclude','low_priority','focus','exception']),sectorTags:strings,definition:text,conditions:text,enabled:z.boolean(),priority:z.number().int().min(0).max(10000),notes:text}).strict()).max(50) }).strict().refine(p => new Set(p.rules.map(r=>r.id)).size===p.rules.length,'Duplicate rule IDs');
export type PolicyConfig = z.infer<typeof policySchema>;
export const modelSchema = z.object({ id:z.string().min(1).max(100), provider:z.enum(['xai','openai']), modelId:z.string().min(1).max(100), baseUrl:z.string().url().optional(), roles:z.array(z.enum(['research','team','synthesis'])).min(1), enabled:z.boolean(), timeoutMs:z.number().int().min(1000).max(120000),maxOutputTokens:z.number().int().min(256).max(16000), webSearch:z.boolean(),xSearch:z.boolean(),allowConfidential:z.boolean(),apiKey:z.string().max(1000).optional(),apiKeyMasked:z.string().optional() }).strict();
export type ModelConfig = z.infer<typeof modelSchema>;
export const modelConfigsSchema = z.object({version:text,models:z.array(modelSchema).max(10)}).strict().refine(c=>new Set(c.models.map(m=>m.id)).size===c.models.length,'Duplicate model IDs');
export const submissionSchema = z.object({website:publicUrl.optional(),uploadId:z.string().uuid().optional(),note:z.string().max(500).optional(),stage:stageSchema.default('unknown'),demoScenario:z.enum(['standard','insufficient','policy','failure']).optional()}).strict().refine(v=>!!v.website||!!v.uploadId,'Website or PDF required');
