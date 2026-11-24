import React, { useEffect, useState } from "react";
import { screeningRequest } from "../services/screeningClient";
import { label, type Lang } from "./ScreeningResult";
import {
  modelConfigsSchema,
  pdfUnderstandingTimeoutSchema,
  policySchema,
  scoringSchema,
} from "../shared/screening-schema";

type Model = {
  id: string;
  provider: "openai";
  modelId: string;
  baseUrl: string;
  roles: ("research" | "team" | "synthesis")[];
  enabled: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  allowConfidential: boolean;
  apiKeyMasked?: string;
  apiKey?: string;
};
type Rule = {
  id: string;
  name: string;
  kind: "hard_exclude" | "low_priority" | "focus" | "exception";
  sectorTags: string[];
  definition: string;
  conditions: string;
  enabled: boolean;
  priority: number;
  notes: string;
};
type Models = {
  version: string;
  pdfUnderstandingTimeoutMs: number;
  models: Model[];
};
type Policy = { version: string; prompt: string; rules: Rule[] };
type Scoring = {
  version: string;
  weights: Record<"pre_seed" | "seed" | "series_a_plus", number[]>;
  coverageThreshold: number;
  hardExcludeConfidence: number;
};
const dimensions = [
  "team",
  "product_technology",
  "sector_positioning",
  "traction_pmf",
  "business_economics",
  "capital_efficiency",
];
export default function AdminSettings({
  token,
  lang,
}: {
  token: string;
  lang: Lang;
}) {
  const t = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [tab, setTab] = useState<"model-configs" | "policy" | "scoring">(
    "model-configs",
  );
  const [models, setModels] = useState<Models | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [scoring, setScoring] = useState<Scoring | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [test, setTest] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      screeningRequest<Models>("/api/admin/model-configs"),
      screeningRequest<Policy>("/api/admin/policy"),
      screeningRequest<Scoring>("/api/admin/scoring"),
    ])
      .then(([m, p, s]) => {
        if (active) {
          setModels({
            ...m,
            pdfUnderstandingTimeoutMs: pdfUnderstandingTimeoutSchema.parse(m.pdfUnderstandingTimeoutMs),
          });
          setPolicy(p);
          setScoring(s);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const model = (i: number, patch: Partial<Model>) => {
    setPreview(false);
    setModels((current) => ({
      ...current!,
      models: current!.models.map((m, n) => (n === i ? { ...m, ...patch } : m)),
    }));
  };
  const rule = (i: number, patch: Partial<Rule>) => {
    setPreview(false);
    setPolicy((current) => ({
      ...current!,
      rules: current!.rules.map((r, n) => (n === i ? { ...r, ...patch } : r)),
    }));
  };
  const payload =
    tab === "model-configs"
      ? {
          ...models,
          models: models?.models.map(
            ({ apiKeyMasked, apiKey, baseUrl, ...m }) => ({
              ...m,
              ...(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
              ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
            }),
          ),
        }
      : tab === "policy"
        ? policy
        : scoring;
  const safePreview =
    tab === "model-configs"
      ? {
          ...models,
          models: models?.models.map(({ apiKey, ...m }) => ({
            ...m,
            ...(apiKey
              ? { apiKey: "[new secret — never shown in preview]" }
              : {}),
          })),
        }
      : payload;
  function validate() {
    if (!models || !policy || !scoring)
      throw new Error(t("Settings are still loading.", "配置仍在加载。"));
    if (
      tab === "scoring" &&
      Object.values(scoring.weights).some(
        (row) =>
          row.length !== 6 ||
          row.some((n) => !Number.isFinite(n) || n < 0 || n > 100) ||
          Math.abs(row.reduce((a, b) => a + b, 0) - 100) > 0.001,
      )
    )
      throw new Error(
        t(
          "Each stage must total 100% across six dimensions.",
          "每个阶段的六维权重合计必须为 100%。",
        ),
      );
    if (
      tab === "policy" &&
      (policy.prompt.length > 12000 ||
        policy.rules.some(
          (r) =>
            !r.id ||
            !r.name ||
            r.definition.length > 5000 ||
            r.conditions.length > 5000,
        ))
    )
      throw new Error(
        t(
          "Check rule IDs/names and policy length limits.",
          "请检查规则 ID、名称与策略长度上限。",
        ),
      );
    if (
      tab === "model-configs" &&
      models.models.some(
        (m) =>
          !m.id ||
          !m.modelId ||
          !m.roles.length ||
          m.timeoutMs <= 0 ||
          m.maxOutputTokens <= 0,
      )
    )
      throw new Error(
        t(
          "Each model needs an ID, model ID, role and positive limits.",
          "每个模型需配置 ID、模型 ID、角色和正数限制。",
        ),
      );
    const schema =
      tab === "model-configs"
        ? modelConfigsSchema
        : tab === "policy"
          ? policySchema
          : scoringSchema;
    const checked = schema.safeParse(payload);
    if (!checked.success)
      throw new Error(
        checked.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      );
  }
  async function save() {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      validate();
      const saved = await screeningRequest<Models | Policy | Scoring>(
        `/api/admin/${tab}`,
        token,
        "PUT",
        payload,
      );
      if (tab === "model-configs") setModels(saved as Models);
      else if (tab === "policy") setPolicy(saved as Policy);
      else setScoring(saved as Scoring);
      setPreview(false);
      setMessage(
        t(
          "Saved. New jobs use this configuration version.",
          "已保存。新任务将使用此配置版本。",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const version =
    tab === "model-configs"
      ? models?.version
      : tab === "policy"
        ? policy?.version
        : scoring?.version;
  return (
    <section className="admin-settings">
      <div className="intro">
        <p className="eyebrow">02 / {t("ADMINISTRATION", "管理员后台")}</p>
        <h1>{t("Configure the research boundary.", "配置研究边界。")}</h1>
        <p>
          {t(
            "Changes apply to new jobs only. Secrets stay on the server.",
            "配置仅对新任务生效。密钥保存在服务器。",
          )}
        </p>
      </div>
      <div className="admin-tabs">
        {(["model-configs", "policy", "scoring"] as const).map((key, i) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setPreview(false);
              setError("");
              setMessage("");
            }}
          >
            {
              [
                t("Models", "模型"),
                t("Investment policy", "投资策略"),
                t("Scoring", "评分"),
              ][i]
            }
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="panel">
        <div className="section-top">
          <h2>
            {tab === "model-configs"
              ? t("Model configurations", "模型配置")
              : tab === "policy"
                ? t("Investment policy", "投资策略")
                : t("Scoring settings", "评分设置")}
          </h2>
          <span className="badge">
            {t("Version", "版本")} {version || "…"}
          </span>
        </div>
        {!models || !policy || !scoring ? (
          <p role="status">{t("Loading settings…", "正在加载配置…")}</p>
        ) : (
          <>
            <fieldset disabled={busy || preview}>
              {tab === "model-configs" && (
                <>
                  <p className="muted">
                    {t(
                      "Text analysis uses Chat Completions. Public company, team and Twitter/X research uses the research model’s Responses web_search capability and the same API key; no separate search key or native x_search is required. Unsupported or inaccessible search is disclosed. The connection test checks text only. Blank API key preserves the stored secret; save before testing.",
                      "文本分析使用 Chat Completions；官网、人员与 Twitter/X 公开研究使用 research 模型的 Responses web_search 能力及同一 API 密钥，无需独立搜索 Key 或原生 x_search。不支持搜索或来源不可读时会明确披露。连接测试仅验证文本调用；API 密钥留空保留原密钥，请先保存再测试。",
                    )}
                  </p>
                  <label>
                    {t("PDF understanding budget (minutes)", "PDF 理解预算（分钟）")}
                    <input
                      type="number"
                      min={1}
                      max={10}
                      step={1}
                      value={models.pdfUnderstandingTimeoutMs / 60000}
                      onChange={(e) =>
                        setModels({ ...models, pdfUnderstandingTimeoutMs: Number(e.target.value) * 60000 })
                      }
                    />
                  </label>
                  <p className="muted">
                    {t(
                      "Default 5 minutes, up to 10. The first model pass over permitted PDF text, including one format correction, shares this budget instead of the model timeout. Its actual duration is excluded from the 8-minute analysis and 10-minute hard limits. Later calls use the normal limits. New jobs only.",
                      "默认 5 分钟，最多 10 分钟。首次模型理解获准 PDF 文本及一次格式纠正共用此预算，不受模型普通超时限制；实际用时不计入 8 分钟分析与 10 分钟硬上限。后续调用仍用原限制，仅对新任务生效。",
                    )}
                  </p>
                  {models.models.map((m, i) => (
                    <section className="admin-card" key={i}>
                      <h3>{m.id || t("New model", "新增模型")}</h3>
                      <div className="field-grid">
                        {(["id", "modelId", "baseUrl"] as const).map((key) => (
                          <label key={key}>
                            {label(key, lang)}
                            <input
                              required
                              value={m[key]}
                              onChange={(e) =>
                                model(i, { [key]: e.target.value })
                              }
                            />
                          </label>
                        ))}
                        <label>
                          {t("Provider", "供应商")}
                          <select
                            value={m.provider}
                            onChange={(e) =>
                              model(i, {
                                provider: e.target.value as Model["provider"],
                              })
                            }
                          >
                            <option value="openai">OpenAI-compatible</option>
                          </select>
                        </label>
                        <label>
                          {t(
                            "API key · blank preserves secret",
                            "API 密钥 · 留空保留原值",
                          )}
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={m.apiKey || ""}
                            placeholder={
                              m.apiKeyMasked || t("Not configured", "未配置")
                            }
                            onChange={(e) =>
                              model(i, { apiKey: e.target.value })
                            }
                          />
                        </label>
                        {(["timeoutMs", "maxOutputTokens"] as const).map(
                          (key) => (
                            <label key={key}>
                              {label(key, lang)}
                              <input
                                type="number"
                                min={1}
                                required
                                value={m[key]}
                                onChange={(e) =>
                                  model(i, { [key]: Number(e.target.value) })
                                }
                              />
                            </label>
                          ),
                        )}
                      </div>
                      <div className="checks">
                        {(["research", "team", "synthesis"] as const).map(
                          (role) => (
                            <label key={role}>
                              <input
                                type="checkbox"
                                checked={m.roles.includes(role)}
                                onChange={(e) =>
                                  model(i, {
                                    roles: e.target.checked
                                      ? [...m.roles, role]
                                      : m.roles.filter((r) => r !== role),
                                  })
                                }
                              />
                              {label(role, lang)}
                            </label>
                          ),
                        )}
                        {(
                          [
                            "enabled",
                            "allowConfidential",
                          ] as const
                        ).map((key) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={m[key]}
                              onChange={(e) =>
                                model(i, { [key]: e.target.checked })
                              }
                            />
                            {label(key, lang)}
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={async () => {
                          setBusy(true);
                          setTest(null);
                          setError("");
                          try {
                            setTest(
                              await screeningRequest(
                                "/api/admin/model-configs/test",
                                token,
                                "POST",
                                { id: m.id },
                              ),
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {t(
                          "Test saved model connection",
                          "测试已保存模型连接",
                        )}
                      </button>{" "}
                      <button
                        onClick={() =>
                          setModels({
                            ...models,
                            models: models.models.filter((_, n) => n !== i),
                          })
                        }
                      >
                        {t("Remove", "删除")}
                      </button>
                    </section>
                  ))}
                  <button
                    onClick={() =>
                      setModels({
                        ...models,
                        models: [
                          ...models.models,
                          {
                            id: "",
                            provider: "openai",
                            modelId: "",
                            baseUrl: "https://api.openai.com/v1",
                            roles: ["research"],
                            enabled: false,
                            timeoutMs: 60000,
                            maxOutputTokens: 4000,
                            allowConfidential: false,
                          },
                        ],
                      })
                    }
                  >
                    + {t("Add model", "添加模型")}
                  </button>
                </>
              )}
              {tab === "policy" && (
                <>
                  <p className="muted">
                    {t(
                      "Optional: leave rules empty or disable all rules to skip policy matching. Focus (including a winning exception) adds 5 non-stacking research-priority points, capped at 100, only when a quality score exists. Quality scores and evidence coverage remain independent.",
                      "策略可选：规则留空或全部停用即可跳过匹配。重点关注（含优先命中的例外）仅在已有质量分时，为研究优先分加 5 分，不叠加、封顶 100；质量评分与证据覆盖保持独立。",
                    )}
                  </p>
                  <label>
                    {t(
                      "Investment preference prompt · max 12,000 characters",
                      "投资偏好 Prompt · 最多 12,000 字符",
                    )}
                    <textarea
                      rows={7}
                      maxLength={12000}
                      value={policy.prompt}
                      onChange={(e) =>
                        setPolicy({ ...policy, prompt: e.target.value })
                      }
                    />
                  </label>
                  {policy.rules.map((r, i) => (
                    <section className="admin-card" key={i}>
                      <h3>{r.name || t("New rule", "新增规则")}</h3>
                      <div className="field-grid">
                        {(
                          [
                            "id",
                            "name",
                            "definition",
                            "conditions",
                            "notes",
                          ] as const
                        ).map((key) => (
                          <label key={key}>
                            {label(key, lang)}
                            <textarea
                              rows={
                                key === "definition" || key === "conditions"
                                  ? 3
                                  : 1
                              }
                              maxLength={5000}
                              value={r[key]}
                              onChange={(e) =>
                                rule(i, { [key]: e.target.value })
                              }
                            />
                          </label>
                        ))}
                        <label>
                          {t("Kind", "规则类型")}
                          <select
                            value={r.kind}
                            onChange={(e) =>
                              rule(i, { kind: e.target.value as Rule["kind"] })
                            }
                          >
                            {[
                              "hard_exclude",
                              "low_priority",
                              "focus",
                              "exception",
                            ].map((k) => (
                              <option key={k}>{k}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t(
                            "Sector tags · comma-separated",
                            "细分赛道标签 · 逗号分隔",
                          )}
                          <input
                            value={r.sectorTags.join(",")}
                            onChange={(e) =>
                              rule(i, { sectorTags: e.target.value.split(",") })
                            }
                          />
                        </label>
                        <label>
                          {t("Priority", "优先级")}
                          <input
                            type="number"
                            value={r.priority}
                            onChange={(e) =>
                              rule(i, { priority: Number(e.target.value) })
                            }
                          />
                        </label>
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          onChange={(e) =>
                            rule(i, { enabled: e.target.checked })
                          }
                        />
                        {t("Enabled", "启用")}
                      </label>
                      <button
                        onClick={() =>
                          setPolicy({
                            ...policy,
                            rules: policy.rules.filter((_, n) => n !== i),
                          })
                        }
                      >
                        {t("Remove rule", "删除规则")}
                      </button>
                    </section>
                  ))}
                  <button
                    onClick={() =>
                      setPolicy({
                        ...policy,
                        rules: [
                          ...policy.rules,
                          {
                            id: "",
                            name: "",
                            kind: "focus",
                            sectorTags: [],
                            definition: "",
                            conditions: "",
                            enabled: false,
                            priority: 0,
                            notes: "",
                          },
                        ],
                      })
                    }
                  >
                    + {t("Add rule", "添加规则")}
                  </button>
                </>
              )}
              {tab === "scoring" && (
                <>
                  <p className="muted">
                    {t(
                      "Each stage totals 100%. Missing evidence remains null; policy never changes the quality score.",
                      "每个阶段合计 100%。缺失证据保持 null，策略不改变质量评分。",
                    )}
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Dimension", "维度")}</th>
                          {Object.keys(scoring.weights).map((stage) => (
                            <th key={stage}>{stage}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dimensions.map((id, i) => (
                          <tr key={id}>
                            <th>{label(id, lang)}</th>
                            {Object.entries(scoring.weights).map(
                              ([stage, weights]) => (
                                <td key={stage}>
                                  <input
                                    aria-label={`${stage} ${id}`}
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={weights[i]}
                                    onChange={(e) =>
                                      setScoring({
                                        ...scoring,
                                        weights: {
                                          ...scoring.weights,
                                          [stage]: weights.map((w, n) =>
                                            n === i
                                              ? Number(e.target.value)
                                              : w,
                                          ),
                                        },
                                      })
                                    }
                                  />
                                </td>
                              ),
                            )}
                          </tr>
                        ))}
                        <tr>
                          <th>{t("Total", "合计")}</th>
                          {Object.values(scoring.weights).map((row, i) => (
                            <td key={i}>{row.reduce((a, b) => a + b, 0)}%</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="field-grid">
                    {(
                      [
                        "coverageThreshold",
                        "hardExcludeConfidence",
                      ] as const
                    ).map((key) => (
                      <label key={key}>
                        {label(key, lang)}
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.01}
                          value={scoring[key]}
                          onChange={(e) =>
                            setScoring({
                              ...scoring,
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
            </fieldset>
            {test !== null && tab === "model-configs" && (
              <section aria-label={t("Connectivity result", "连接测试结果")}>
                <h3>{t("Actual connectivity result", "实际连接测试结果")}</h3>
                <pre>{JSON.stringify(test, null, 2)}</pre>
              </section>
            )}
            <div className="admin-actions">
              {!preview ? (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    try {
                      validate();
                      setPreview(true);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {t("Preview changes", "预览修改")}
                </button>
              ) : (
                <>
                  <section className="config-preview">
                    <h3>{t("Review before saving", "保存前确认")}</h3>
                    <pre>{JSON.stringify(safePreview, null, 2)}</pre>
                  </section>
                  <button disabled={busy} onClick={() => setPreview(false)}>
                    {t("Back to editing", "返回编辑")}
                  </button>
                  <button className="primary" disabled={busy} onClick={save}>
                    {busy
                      ? t("Saving…", "正在保存…")
                      : t("Save new version", "保存新版本")}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
