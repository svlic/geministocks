import React from "react";
import type { ScreeningResult } from "../shared/screening-schema";
import { downloadScreeningMarkdown } from "../services/screeningMarkdown";

export type Lang = "en" | "zh";
const labels: Record<string, [string, string]> = {
  standard: ["Screening report", "初筛报告"],
  brief_insufficient: ["Insufficient information", "信息不足"],
  brief_policy: ["Policy mismatch", "策略不匹配"],
  failed: ["Technical failure", "技术故障"],
  partial_error: ["Partial technical failure", "部分技术故障"],
  company: ["Project overview", "项目概览"],
  policyMatch: ["Policy match", "策略匹配"],
  team: ["Team screening", "团队初评"],
  dimensions: ["Scores and evidence", "评分与证据"],
  sectorAndPositioning: ["Sector and positioning", "赛道与定位"],
  productAndTechnology: ["Product and technology", "产品与技术"],
  directPrivateComps: ["Direct private comparables", "直接同赛道未上市对标"],
  adjacentCompetitors: ["Adjacent competitors", "相邻竞争对手"],
  publicCompanyRefs: ["Public company references", "上市公司参考"],
  majorStrengths: ["Major strengths", "主要亮点"],
  majorRisks: ["Major risks", "主要风险"],
  missingMaterials: ["Required materials", "待索取材料"],
  limitations: ["Technical limitations", "技术限制"],
  execution: ["Execution metadata", "执行信息"],
  evidence: ["Sources and page map", "来源与页码映射"],
  verified: ["Independently verified", "独立核实"],
  company_claim: ["Company claim", "公司自述"],
  unverified: ["Unverified", "未经核实"],
  conflicting: ["Conflicting evidence", "证据冲突"],
  inference: ["Model inference", "模型推断"],
  unknown: ["Unknown", "未知"],
  sufficient: ["Sufficient", "充分"],
  insufficient: ["Insufficient", "不足"],
  partial: ["Partial", "部分"],
  teamScore: ["Team", "团队"],
  product_technology: ["Product / technology", "产品技术"],
  sector_positioning: ["Sector positioning", "赛道定位"],
  traction_pmf: ["Traction / PMF", "产品验证"],
  business_economics: ["Business economics", "商业经济性"],
  capital_efficiency: ["Capital efficiency", "资金效率"],
  name: ["Name", "名称"],
  website: ["Website", "官网"],
  aliases: ["Aliases", "别名"],
  productSummary: ["Product summary", "产品简介"],
  targetCustomers: ["Target customers", "目标客户"],
  sectorPath: ["Sector path", "细分赛道"],
  stage: ["Stage", "融资阶段"],
  stageConfidence: ["Stage confidence", "阶段置信度"],
  identityConfidence: ["Identity confidence", "身份置信度"],
  status: ["Status", "状态"],
  matchedRuleIds: ["Matched rule IDs", "命中规则 ID"],
  policyVersion: ["Policy version", "策略版本"],
  confidence: ["Confidence", "置信度"],
  explanation: ["Explanation", "说明"],
  evidenceIds: ["Evidence references", "证据引用"],
  founders: ["Core team", "核心团队"],
  title: ["Title", "职务 / 标题"],
  professionalFacts: ["Professional facts", "专业背景事实"],
  keyUnknowns: ["Key unknowns", "关键未知项"],
  subScores: ["Team sub-scores / 5", "团队子项 / 5"],
  subScoreEvidence: ["Evidence for each team sub-score", "团队子项评分依据"],
  strengths: ["Strengths", "优势"],
  weaknessesOrRisks: ["Weaknesses / risks", "弱项 / 风险"],
  requiredMaterials: ["Required materials", "待索取材料"],
  founderMarketFit: ["Founder-market fit", "创始人与市场匹配"],
  complementarity: ["Complementarity", "核心能力互补"],
  trackRecord: ["Verified achievements", "可验证成果"],
  commitment: ["Commitment", "投入与稳定性"],
  text: ["Claim", "事实 / 判断"],
  verification: ["Verification", "核实状态"],
  id: ["ID", "编号"],
  score0to5: ["Score / 5", "评分 / 5"],
  weightPercent: ["Weight (%)", "权重（%）"],
  rationale: ["Rationale", "评分理由"],
  evidenceState: ["Evidence state", "证据状态"],
  category: ["Category", "对标类别"],
  sectorFit: ["Sector fit", "赛道可比性"],
  productFit: ["Product fit", "产品可比性"],
  customerFit: ["Customer fit", "客户可比性"],
  notableDifferences: ["Notable differences", "重要差异"],
  financing: ["Financing events", "融资事件"],
  date: ["Date", "日期"],
  round: ["Round", "轮次"],
  amount: ["Financing amount", "融资金额"],
  currency: ["Currency", "币种"],
  valuation: ["Valuation", "估值"],
  valuationBasis: ["Valuation basis", "估值口径"],
  investors: ["Public investors", "公开投资人"],
  publicMarketData: ["Public market data", "上市公司数据"],
  ticker: ["Ticker", "股票代码"],
  metricAsOf: ["Data as of", "数据时点"],
  revenueGrowth: ["Revenue growth", "收入增长"],
  grossMargin: ["Gross margin", "毛利率"],
  valuationMultiple: ["Valuation multiple", "估值倍数"],
  multipleType: ["Multiple basis", "倍数口径"],
  notes: ["Notes and boundaries", "说明与边界"],
  type: ["Source type", "来源类型"],
  url: ["Source URL", "来源链接"],
  documentId: ["Document ID", "文档编号"],
  page: ["PDF page", "PDF 页码"],
  publishedAt: ["Published at", "发布时间"],
  retrievedAt: ["Retrieved at", "实际采集时间"],
  quoteOrSummary: ["Evidence excerpt", "证据摘要"],
  schemaVersion: ["Schema version", "结构版本"],
  provider: ["Provider", "供应商"],
  modelId: ["Model ID", "模型 ID"],
  searchUsed: ["Web search used", "实际使用网页搜索"],
  xSearchUsed: ["X search used", "实际使用 X 搜索"],
  elapsedMs: ["Elapsed (ms)", "耗时（毫秒）"],
  approximateCost: ["Approximate cost", "估算费用"],
  focus: ["Focus", "重点关注"],
  low_priority: ["Low priority", "低优先级"],
  hard_exclude: ["Hard exclusion", "硬性排除"],
  exception: ["Exception", "例外"],
  evaluated: ["Evaluated", "已评估"],
  insufficient_evidence: ["Insufficient evidence", "证据不足"],
  not_run: ["Not run", "未执行"],
  error: ["Technical error", "技术错误"],
  pre_seed: ["Pre-seed / angel", "Pre-seed / 天使"],
  seed: ["Seed", "种子轮"],
  series_a_plus: ["Series A+", "A 轮及以后"],
  direct_private: ["Direct private", "直接未上市对标"],
  adjacent: ["Adjacent", "相邻竞争对手"],
  public_reference: ["Public reference", "上市公司参考"],
  pre_money: ["Pre-money", "投前"],
  post_money: ["Post-money", "投后"],
  not_disclosed: ["Not disclosed", "未披露"],
  official_website: ["Official website", "官网"],
  uploaded_deck: ["Uploaded deck / company claim", "上传 Deck / 公司自述"],
  official_social: ["Official social account", "官方社交账号"],
  third_party: ["Third party", "第三方"],
  financial_filing: ["Financial filing", "财务披露"],
  other: ["Other source", "其他来源"],
  baseUrl: ["Base URL", "模型服务地址"],
  timeoutMs: ["Timeout (ms)", "超时（毫秒）"],
  maxOutputTokens: ["Maximum output tokens", "最大输出 Token"],
  research: ["Research role", "研究角色"],
  synthesis: ["Synthesis role", "合成角色"],
  enabled: ["Enabled", "启用"],
  webSearch: ["Enable native web search", "启用原生网页搜索"],
  xSearch: ["Enable native X search", "启用原生 X 搜索"],
  allowConfidential: ["Allow confidential documents", "允许处理保密文档"],
  definition: ["Sector definition", "赛道定义"],
  conditions: ["Match conditions", "匹配条件"],
  coverageThreshold: ["Coverage threshold", "覆盖率门槛"],
  hardExcludeConfidence: ["Hard-exclusion confidence", "硬排除置信度门槛"],
  researchTurns: ["Research turn budget", "研究回合预算"],
  teamTurns: ["Team turn budget", "团队回合预算"],
};
export function label(key: string, lang: Lang) {
  return (
    labels[key]?.[lang === "zh" ? 1 : 0] ||
    key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")
  );
}
function safeLink(value: string) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function Value({
  value,
  lang,
  field = "",
}: {
  value: unknown;
  lang: Lang;
  field?: string;
}) {
  if (value === null || value === undefined)
    return (
      <span className="muted">
        {lang === "zh" ? "未披露 / 未知" : "Not disclosed / unknown"}
      </span>
    );
  if (Array.isArray(value)) {
    if (!value.length)
      return (
        <p className="muted">
          {lang === "zh" ? "无可验证记录" : "No verifiable records"}
        </p>
      );
    return (
      <ul className="report-list">
        {value.map((item, i) => (
          <li key={i}>
            {field === "evidenceIds" ? (
              <a href={`#evidence-${encodeURIComponent(String(item))}`}>
                [{String(item)}]
              </a>
            ) : (
              <Value value={item} lang={lang} />
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object")
    return (
      <dl className="report-fields">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{label(key, lang)}</dt>
            <dd>
              <Value value={item} lang={lang} field={key} />
            </dd>
          </div>
        ))}
      </dl>
    );
  if ((field === "website" || field === "url") && typeof value === "string") {
    const href = safeLink(value);
    return href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {value} ↗
      </a>
    ) : (
      <span>
        {value} ({lang === "zh" ? "无效链接" : "invalid link"})
      </span>
    );
  }
  if (
    field === "verification" ||
    field === "stage" ||
    field === "evidenceState" ||
    field === "status" ||
    field === "category" ||
    field === "valuationBasis" ||
    field === "type" ||
    field === "id"
  )
    return <span className="badge">{label(String(value), lang)}</span>;
  if (field === "page")
    return (
      <strong>
        PDF · {lang === "zh" ? "第" : "page"} {String(value)}{" "}
        {lang === "zh" ? "页" : ""}
      </strong>
    );
  if (field === "stage" && value === "unknown")
    return <span className="badge">{lang === "zh" ? "未知 · 阶段暂定" : "Unknown · provisional stage"}</span>;
  return (
    <span>
      {typeof value === "boolean"
        ? value
          ? lang === "zh"
            ? "是"
            : "Yes"
          : lang === "zh"
            ? "否"
            : "No"
        : String(value)}
    </span>
  );
}
export default function ScreeningResultView({
  result: r,
  lang,
}: {
  result: ScreeningResult;
  lang: Lang;
}) {
  const brief = r.mode === "brief_insufficient" || r.mode === "brief_policy";
  const failure = r.mode === "failed" || r.mode === "partial_error";
  const sections = (
    brief || r.mode === "failed"
      ? [
          "company",
          "policyMatch",
          "sectorAndPositioning",
          "productAndTechnology",
          "dimensions",
          "missingMaterials",
        ]
      : [
          "company",
          "majorStrengths",
          "majorRisks",
          "policyMatch",
          "team",
          "sectorAndPositioning",
          "productAndTechnology",
          "directPrivateComps",
          "adjacentCompetitors",
          "publicCompanyRefs",
          "dimensions",
          "missingMaterials",
        ]
  ) as (keyof ScreeningResult)[];
  return (
    <article className="screening-report" aria-label={label(r.mode, lang)}>
      <header className="report-heading">
        <div>
          <p className="eyebrow">
            {r.jobId} · {r.generatedAt}
          </p>
          <h2>{label(r.mode, lang)}</h2>
        </div>
        <button onClick={() => downloadScreeningMarkdown(r)}>
          {lang === "zh" ? "导出 Markdown" : "Export Markdown"} ↓
        </button>
      </header>
      {failure && (
        <p className="notice danger">
          {lang === "zh"
            ? "技术限制不等于公司资料不足。可新建任务重试。"
            : "A technical limitation is not a lack of company information. Start a new task to retry."}
        </p>
      )}
      {r.mode === "brief_policy" && (
        <p className="notice">
          {lang === "zh"
            ? "策略不匹配不代表项目质量差。"
            : "Policy mismatch does not imply poor project quality."}
        </p>
      )}
      <p className="report-summary">{r.summary}</p>
      <div className="metrics">
        <div>
          <small>
            {lang === "zh" ? "暂定质量分" : "Provisional quality score"}
          </small>
          <strong>
            {r.totalScore === null ? "—" : `${r.totalScore} / 100`}
          </strong>
          {r.totalScore === null && (
            <span>
              {r.mode === "brief_policy"
                ? lang === "zh"
                  ? "按策略提前结束，未计算质量分"
                  : "Stopped by policy; quality not scored"
                : failure
                ? lang === "zh"
                  ? "技术限制，未形成综合分"
                  : "Overall score unavailable due to technical limitations"
                : lang === "zh"
                  ? "信息不足，无法形成综合分"
                  : "Insufficient evidence for an overall score"}
            </span>
          )}
        </div>
        <div>
          <small>
            {lang === "zh" ? "加权证据覆盖" : "Weighted evidence coverage"}
          </small>
          <strong>{Math.round(r.evidenceCoverage * 100)}%</strong>
        </div>
        <div>
          <small>
            {lang === "zh" ? "独立策略状态" : "Independent policy status"}
          </small>
          <strong>{label(r.policyMatch.status, lang)}</strong>
        </div>
      </div>
      {sections.map((key) => {
        const v = r[key];
        if ((v === null || (Array.isArray(v) && !v.length)) &&
            (brief || key !== "directPrivateComps"))
          return null;
        return (
          <details key={key} open={key === "company" || key === "team" || key === "dimensions"}>
            <summary><h3 style={{display:'inline'}}>{label(key, lang)}</h3></summary>
            {key === "directPrivateComps" && Array.isArray(v) && !v.length ? (
              <p>
                {lang === "zh"
                  ? "未找到足够可信的直接可比公司"
                  : "No sufficiently credible direct comparables found"}
              </p>
            ) : (
              <Value value={v} lang={lang} />
            )}
          </details>
        );
      })}
      <section>
        <h3>{label("evidence", lang)}</h3>
        {r.evidence.map((e) => (
          <div
            className="evidence-card"
            id={`evidence-${encodeURIComponent(e.id)}`}
            key={e.id}
          >
            <h4>
              [{e.id}] {e.title}
            </h4>
            <Value value={e} lang={lang} />
          </div>
        ))}
      </section>
      <section>
        <h3>{label("limitations", lang)}</h3>
        <Value value={r.limitations} lang={lang} />
      </section>
      <details>
        <summary>{label("execution", lang)}</summary>
        <Value
          value={{ schemaVersion: r.schemaVersion, ...r.execution }}
          lang={lang}
        />
      </details>
      <p className="muted">
        {lang === "zh"
          ? "仅供研究优先级参考，不构成投资决策。"
          : "For research prioritization only. Not an investment decision."}
      </p>
    </article>
  );
}
