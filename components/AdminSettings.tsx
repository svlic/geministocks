import React, { useEffect, useState } from "react";
import { screeningRequest } from "../services/screeningClient";
import { label, type Lang } from "./ScreeningResult";
import {
  modelConfigsSchema,
  policySchema,
  scoringSchema,
} from "../shared/screening-schema";

type Model = {
  id: string;
  provider: "xai" | "openai";
  modelId: string;
  baseUrl: string;
  roles: ("research" | "team" | "synthesis")[];
  enabled: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  webSearch: boolean;
  xSearch: boolean;
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
type Models = { version: string; models: Model[] };
type Policy = { version: string; prompt: string; rules: Rule[] };
type Scoring = {
  version: string;
  weights: Record<"pre_seed" | "seed" | "series_a_plus", number[]>;
  coverageThreshold: number;
  hardExcludeConfidence: number;
  researchTurns: number;
  teamTurns: number;
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
          setModels(m);
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
                      "Blank API key preserves the stored secret. Save before running a connectivity test; tests use the saved version.",
                      "API 密钥留空则保留原密钥。请先保存再测试连接；测试使用已保存配置。",
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
                            <option value="xai">xAI · native Responses</option>
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
                            "webSearch",
                            "xSearch",
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
                          "Test saved model and tools",
                          "测试已保存模型与工具",
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
                            provider: "xai",
                            modelId: "",
                            baseUrl: "https://api.x.ai/v1",
                            roles: ["research"],
                            enabled: false,
                            timeoutMs: 60000,
                            maxOutputTokens: 4000,
                            webSearch: false,
                            xSearch: false,
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
                        "researchTurns",
                        "teamTurns",
                      ] as const
                    ).map((key) => (
                      <label key={key}>
                        {label(key, lang)}
                        <input
                          type="number"
                          min={0}
                          max={key.endsWith("Turns") ? 10 : 1}
                          step={key.endsWith("Turns") ? 1 : 0.01}
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
