import React, { useEffect, useRef, useState } from "react";
import {
  screeningResultSchema,
  type ScreeningResult,
} from "./shared/screening-schema";
import ScreeningResultView, { type Lang } from "./components/ScreeningResult";
import AdminSettings from "./components/AdminSettings";
import {
  screeningRequest,
  uploadDeck,
  type Session,
  type Job,
} from "./services/screeningClient";

const phases = [
  "reading",
  "identity",
  "policy",
  "research",
  "scoring",
  "output",
];
const phaseNames = {
  en: [
    "Read materials",
    "Confirm identity",
    "Match policy",
    "Public research",
    "Score and verify",
    "Output",
  ],
  zh: [
    "读取资料",
    "确认项目身份",
    "策略匹配",
    "联网调查",
    "评分与验证",
    "输出",
  ],
};
export default function App() {
  const [lang, setLang] = useState<Lang>("zh");
  const t = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [website, setWebsite] = useState("");
  const [note, setNote] = useState("");
  const [stage, setStage] = useState("unknown");
  const [file, setFile] = useState<File | null>(null);
  const [scenario, setScenario] = useState("standard");
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [pollRetry, setPollRetry] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    screeningRequest<Session>("/api/auth/me")
      .then((s) => {
        if (active) setSession(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = t("First Look · Project screening", "初见 · 项目初筛");
  }, [lang]);
  useEffect(() => {
    if (!job || result || job.status === "cancelled") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = job.id;
    async function poll() {
      try {
        const current = await screeningRequest<Job>(
          `/api/screen/jobs/${encodeURIComponent(id)}`,
        );
        if (!active) return;
        setJob(current);
        if (current.status === "completed" || current.status === "failed") {
          try {
            const raw = await screeningRequest<unknown>(
              `/api/screen/jobs/${encodeURIComponent(id)}/result`,
            );
            const parsed = screeningResultSchema.safeParse(raw);
            if (!parsed.success)
              throw new Error(
                "报告结构校验失败 / Report validation failed. No unvalidated report was displayed.",
              );
            const report = parsed.data;
            if (active) {
              setResult(report);
              setError("");
            }
          } catch (e) {
            if (active) setError(current.error || (e as Error).message);
          }
        } else if (current.status !== "cancelled")
          timer = setTimeout(poll, 1500);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job?.id, pollRetry, Boolean(result)]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setSession(
        await screeningRequest<Session>(
          "/api/auth/login",
          session?.csrfToken || "",
          "POST",
          { username, password },
        ),
      );
      setPassword("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || busy) return;
    setError("");
    if (!website.trim() && !file) {
      setError(
        t("Provide a website URL or PDF deck.", "请提供官网 URL 或 PDF。"),
      );
      return;
    }
    if (website.trim()) {
      try {
        const u = new URL(website.trim());
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          (u.port && u.port !== "443")
        )
          throw new Error();
      } catch {
        setError(t("Enter a public HTTPS URL.", "请输入公网 HTTPS URL。"));
        return;
      }
    }
    if (
      file &&
      (file.size > 25 * 1024 * 1024 ||
        file.type !== "application/pdf" ||
        !file.name.toLowerCase().endsWith(".pdf"))
    ) {
      setError(
        t(
          "PDF only, maximum 25 MB and 40 pages.",
          "仅接受 PDF，最大 25 MB / 40 页。",
        ),
      );
      return;
    }
    setLocked(true);
    setBusy(true);
    const turn = ++generation.current;
    try {
      const uploadId = file
        ? await uploadDeck(file, session!.csrfToken)
        : undefined;
      const created = await screeningRequest<Job>(
        "/api/screen/jobs",
        session!.csrfToken,
        "POST",
        {
          ...(website.trim() ? { website: website.trim() } : {}),
          ...(uploadId ? { uploadId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          stage,
          ...(session?.demoMode ? { demoScenario: scenario } : {}),
        },
      );
      if (turn === generation.current) setJob(created);
    } catch (e) {
      if (turn === generation.current) setError((e as Error).message);
    } finally {
      if (turn === generation.current) setBusy(false);
    }
  }
  async function cancel() {
    if (!job || cancelling) return;
    setCancelling(true);
    setError("");
    try {
      await screeningRequest(
        `/api/screen/jobs/${encodeURIComponent(job.id)}/cancel`,
        session!.csrfToken,
        "POST",
      );
      setPollRetry((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  }
  function reset() {
    generation.current++;
    setJob(null);
    setResult(null);
    setWebsite("");
    setNote("");
    setFile(null);
    setStage("unknown");
    setLocked(false);
    setError("");
    setBusy(false);
    setAdmin(false);
  }
  const activeJob = job && ["queued", "running"].includes(job.status);
  return (
    <div className="screening-app">
      <header className="app-header">
        <a className="brand" href="#main">
          <span className="brand-mark">F</span>
          <span>
            FIRST LOOK
            <small>{t("PRIVATE MARKET SCREENING", "一级市场项目初筛")}</small>
          </span>
        </a>
        <nav aria-label={t("Main navigation", "主导航")}>
          <button onClick={() => setLang(lang === "en" ? "zh" : "en")}>
            {lang === "en" ? "中文" : "English"}
          </button>
          {session?.user && (
            <>
              <button aria-pressed={!admin} onClick={() => setAdmin(false)}>
                {t("Screening", "项目初筛")}
              </button>
              <button aria-pressed={admin} onClick={() => setAdmin(true)}>
                {t("Admin settings", "管理员设置")}
              </button>
              <button
                disabled={busy || Boolean(activeJob)}
                onClick={async () => {
                  try {
                    await screeningRequest(
                      "/api/auth/logout",
                      session.csrfToken,
                      "POST",
                    );
                    reset();
                    setSession(await screeningRequest<Session>("/api/auth/me"));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {t("Sign out", "退出")}
              </button>
            </>
          )}
        </nav>
      </header>
      <main id="main">
        {session?.demoMode && (
          <aside className="demo-banner" role="note">
            <strong>
              {t("DEMO MODE · Fictional fixtures", "演示模式 · 虚构数据")}
            </strong>
            <span>
              {t(
                "No live research. All company facts are invented examples, not investment evidence.",
                "非真实联网研究。公司资料为虚构示例，不能作为投资证据。",
              )}
            </span>
          </aside>
        )}
        {error && (
          <div className="notice danger" role="alert">
            {error}
            {job && !result && (
              <button
                onClick={() => {
                  setError("");
                  setPollRetry((n) => n + 1);
                }}
              >
                {t("Retry status", "重试读取状态")}
              </button>
            )}
          </div>
        )}
        {!ready ? (
          <p role="status">
            {t("Checking secure session…", "正在检查安全会话…")}
          </p>
        ) : !session?.user ? (
          <section className="login-card panel">
            <p className="eyebrow">FIRST LOOK / PRIVATE ACCESS</p>
            <h1>{t("A clearer first look.", "有依据的第一眼。")}</h1>
            <p className="muted">
              {t(
                "Sign in to your private research workspace.",
                "登录受保护的项目研究工作台。",
              )}
            </p>
            <form onSubmit={login}>
              <label>
                {t("Username", "用户名")}
                <input
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label>
                {t("Password", "密码")}
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={busy || !session}
                type="submit"
              >
                {busy ? t("Signing in…", "正在登录…") : t("Sign in", "登录")}
              </button>
            </form>
            {!session && (
              <button onClick={() => window.location.reload()}>
                {t("Retry connection", "重试连接")}
              </button>
            )}
          </section>
        ) : admin ? (
          <AdminSettings token={session.csrfToken} lang={lang} />
        ) : (
          <>
            <div className="intro">
              <p className="eyebrow">
                01 / {t("EVIDENCE BEFORE CONVICTION", "先有证据，再做判断")}
              </p>
              <h1>
                {t(
                  "One project. One focused screening.",
                  "一个项目，一次有边界的初筛。",
                )}
              </h1>
              <p>
                {t(
                  "Understand the team, the product and the fit. Clear evidence, honest unknowns — not an investment decision.",
                  "看清团队、产品与策略匹配。证据可追溯，未知不猜测；不代替投资决策。",
                )}
              </p>
            </div>
            <div className="screening-grid">
              <section className="panel composer">
                <div className="section-top">
                  <h2>{t("Project materials", "项目资料")}</h2>
                  <span className="badge">
                    {locked ? t("Locked", "已锁定") : t("Single round", "单轮")}
                  </span>
                </div>
                <p className="muted">
                  {t(
                    "Add everything before submitting. Inputs cannot be updated during or after this task.",
                    "请在提交前一次性添加所有资料。本任务开始后不可追加或修改。",
                  )}
                </p>
                <form onSubmit={submit}>
                  <fieldset disabled={locked}>
                    <label>
                      {t("Website URL", "官网 URL")}
                      <input
                        type="url"
                        placeholder="https://company.com"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                      />
                    </label>
                    <label>
                      {t("Pitch deck · PDF", "项目 Deck · PDF")}
                      <input
                        key={locked ? "locked" : "draft"}
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                      {file && <span>{file.name}</span>}
                      <small>
                        {t(
                          "One PDF · up to 25 MB / 40 pages. Page count is validated on the server.",
                          "单份 PDF · 最大 25 MB / 40 页，页数由后端校验。",
                        )}
                      </small>
                    </label>
                    <label>
                      {t("Stage", "融资阶段")}
                      <select
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                      >
                        <option value="unknown">
                          {t(
                            "Unknown · conservative early-stage template",
                            "未知 · 暂用保守早期模板",
                          )}
                        </option>
                        <option value="pre_seed">
                          Pre-seed / {t("Angel", "天使")}
                        </option>
                        <option value="seed">Seed</option>
                        <option value="series_a_plus">Series A+</option>
                      </select>
                    </label>
                    <label>
                      {t("Brief context (optional)", "简短备注（选填）")}
                      <textarea
                        maxLength={500}
                        rows={3}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t(
                          "Company alias or relevant context",
                          "公司别名等背景信息",
                        )}
                      />
                    </label>
                    {session.demoMode && (
                      <label>
                        {t("Demo scenario", "演示场景")}
                        <select
                          value={scenario}
                          onChange={(e) => setScenario(e.target.value)}
                        >
                          <option value="standard">
                            {t("Standard report", "标准报告")}
                          </option>
                          <option value="insufficient">
                            {t("Insufficient information", "信息不足")}
                          </option>
                          <option value="policy">
                            {t("Policy exclusion", "策略排除")}
                          </option>
                          <option value="failure">
                            {t("Technical failure", "技术故障")}
                          </option>
                        </select>
                      </label>
                    )}
                  </fieldset>
                  <p className="privacy-note">
                    {t(
                      "Materials are sent to administrator-configured AI providers for processing. Upload only materials you are authorized to share. Private PDFs and task data are temporary; export your result before leaving.",
                      "资料会发送到管理员配置的 AI 服务商处理。请仅上传有权共享的材料。PDF 与任务数据为临时保存，离开前请导出结果。",
                    )}
                  </p>
                  <button
                    type="submit"
                    className="primary"
                    disabled={locked || busy}
                  >
                    {busy
                      ? t("Submitting materials…", "正在提交资料…")
                      : t("Start screening", "开始初筛")}{" "}
                    <span aria-hidden="true">↗</span>
                  </button>
                </form>
              </section>
              <div className="screening-output">
                {job ? (
                  <section
                    className="panel progress"
                    aria-label={t("Task progress", "任务进度")}
                  >
                    <div className="section-top">
                      <h2>{t("Task progress", "任务进度")}</h2>
                      <span className="badge">{job.status}</span>
                    </div>
                    <ol>
                      {phases.map((phase, i) => (
                        <li
                          key={phase}
                          aria-current={
                            job.phase === phase ? "step" : undefined
                          }
                          className={
                            phases.indexOf(job.phase) > i ? "done" : ""
                          }
                        >
                          <span>
                            {phases.indexOf(job.phase) > i ? "✓" : `0${i + 1}`}
                          </span>
                          {phaseNames[lang][i]}
                        </li>
                      ))}
                    </ol>
                    <p role="status">
                      {job.status === "cancelled"
                        ? t(
                            "Cancelled. Temporary attachments are cleaned up by the server.",
                            "已取消。临时附件由服务器清理。",
                          )
                        : job.status === "failed"
                          ? t(
                              "Technical failure. This is not an information-insufficiency judgment.",
                              "技术故障，不代表公司资料不足。",
                            )
                          : t("Current server phase: ", "当前服务器阶段：") +
                            phaseNames[lang][phases.indexOf(job.phase)]}
                    </p>
                    {activeJob && (
                      <button disabled={cancelling} onClick={cancel}>
                        {cancelling
                          ? t("Requesting cancellation…", "正在取消…")
                          : t("Cancel task", "取消任务")}
                      </button>
                    )}
                  </section>
                ) : (
                  <aside className="empty-state">
                    <span className="large-symbol">↗</span>
                    <h2>
                      {t(
                        "A first look, not a final verdict.",
                        "初步判断，而非最终结论。",
                      )}
                    </h2>
                    <p>
                      {t(
                        "We separate project quality, evidence coverage and investment-policy fit. If the evidence is thin, the report stays short.",
                        "项目质量、证据覆盖、策略匹配各自独立。证据不足，就让报告保持简短。",
                      )}
                    </p>
                    <div>
                      <span>01</span>
                      {t("Team-first research", "团队优先")}
                    </div>
                    <div>
                      <span>02</span>
                      {t("Comparable means comparable", "对标必须真正可比")}
                    </div>
                    <div>
                      <span>03</span>
                      {t("Unknown stays unknown", "未知就是未知")}
                    </div>
                  </aside>
                )}
                {result && <ScreeningResultView result={result} lang={lang} />}
                {locked && !busy && !activeJob && (
                  <button className="new-screening" onClick={reset}>
                    {t("Start a new screening", "新建一次初筛")}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </main>
      <footer>
        FIRST LOOK <span>·</span>{" "}
        {t("Private research. Explicit uncertainty.", "私有研究，坦诚未知。")}{" "}
        <span>·</span> MIT
      </footer>
    </div>
  );
}
