// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import ScreeningResultView from "./components/ScreeningResult";
import { screeningMarkdown } from "./services/screeningMarkdown";
import type { ResultMode, ScreeningResult } from "./shared/screening-schema";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const result = (mode: ResultMode = "standard"): ScreeningResult => ({
  schemaVersion: "1.0",
  jobId: "j",
  mode,
  generatedAt: "2026-11-05T00:00:00.000Z",
  company: null,
  summary: "Bounded conclusion",
  policyMatch: {
    status: "unknown",
    matchedRuleIds: [],
    policyVersion: "v1",
    confidence: 0,
    explanation: "No match",
    evidenceIds: [],
  },
  team: null,
  dimensions: [],
  evidenceCoverage: 0,
  totalScore: null,
  sectorAndPositioning: [],
  productAndTechnology: [],
  directPrivateComps: [],
  adjacentCompetitors: [],
  publicCompanyRefs: [],
  majorStrengths: [],
  majorRisks: [],
  missingMaterials: ["Team introduction"],
  limitations: ["Search unavailable"],
  evidence: [
    {
      id: "e1",
      title: "Deck",
      type: "uploaded_deck",
      url: null,
      documentId: "doc1",
      page: 3,
      publishedAt: null,
      retrievedAt: "2026-11-05T00:00:00.000Z",
      quoteOrSummary: "Product evidence",
    },
  ],
  execution: {
    provider: "fixture",
    modelId: "demo",
    searchUsed: false,
    xSearchUsed: false,
    elapsedMs: 100,
  },
});

it("protects the form behind login", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ user: null, csrfToken: "token", demoMode: false }),
        ),
      ),
  );
  render(<App />);
  expect(await screen.findByLabelText("用户名")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "English" }));
  expect(await screen.findByLabelText(/Username/)).toBeTruthy();
  expect(screen.queryByLabelText(/Website URL/)).toBeNull();
});
it.each(["identity", "understanding"])("locks submitted inputs, displays server phase %s and supports cancellation", async (phase) => {
  let cancelled = false;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/cancel")) cancelled = true;
    if (options?.method === "POST") {
      expect(options.credentials).toBe("same-origin");
      expect(options.headers).toMatchObject({ "x-csrf-token": "token" });
    }
    return new Response(
      JSON.stringify(
        url.includes("/auth/me")
          ? {
              user: { username: "admin", role: "admin" },
              csrfToken: "token",
              demoMode: true,
            }
          : {
              id: "job",
              status: cancelled ? "cancelled" : "running",
              phase,
            },
      ),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "English" }));
  fireEvent.change(await screen.findByLabelText(/Website URL/), {
    target: { value: "https://example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Start screening/ }));
  await screen.findByRole("button", { name: /Cancel task/ });
  for (const input of [
    /Website URL/,
    /Stage/,
    /Brief context/,
    /Demo scenario/,
  ]) {
    expect(screen.getByLabelText(input).matches(":disabled")).toBe(true);
  }
  expect(screen.getByRole("status").textContent).toContain(phase === "understanding" ? "Understand PDF" : "Confirm identity");
  expect(screen.queryByText(/Continue chat/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Cancel task/ }));
  await screen.findByText(/Cancelled. Temporary attachments/);
  expect(screen.getByLabelText(/Website URL/).matches(":disabled")).toBe(true);
  expect(
    screen.getByRole("button", { name: /Start a new screening/ }),
  ).toBeTruthy();
});
it.each<[ResultMode, string]>([
  ["brief_insufficient", "Insufficient information"],
  ["brief_policy", "Policy mismatch"],
  ["failed", "Analysis incomplete"],
  ["partial_error", "Analysis partially complete"],
])("distinguishes %s", (mode, title) => {
  render(<ScreeningResultView result={result(mode)} lang="en" />);
  expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  if (mode.startsWith("brief"))
    expect(
      screen.queryByRole("heading", { name: "Direct private comparables" }),
    ).toBeNull();
});
it.each(["zh", "en"] as const)("shows classified causes without calling every incomplete analysis a technical failure in %s", (lang) => {
  const report = result("partial_error");
  report.issues = [
    { module: "website", kind: "source_limit", code: "robots_unavailable" },
    { module: "synthesis", kind: "invalid_output", code: "invalid_evidence" },
    { module: "team", kind: "execution_failure", code: "timeout" },
    { module: "policy", kind: "configuration", code: "authentication" },
    { module: "analysis", kind: "unknown_failure", code: "module_error" },
  ];
  render(<ScreeningResultView result={report} lang={lang} />);
  for (const name of lang === "zh"
    ? ["来源访问或材料限制", "模型输出校验未通过", "已确认的执行故障", "模型配置或权限问题", "原因未确认的执行异常"]
    : ["Source access or material restriction", "Model output failed validation", "Confirmed execution failure", "Model configuration or permission issue", "Unclassified execution exception"])
    expect(screen.getByText(name)).toBeTruthy();
  expect(screen.queryByText(/部分技术故障|Partial technical failure/)).toBeNull();
  for (const code of ["robots_unavailable", "invalid_evidence", "timeout", "authentication", "module_error"])
    expect(screeningMarkdown(report)).toContain(code.replace(/_/g, "\\_"));
});
it("exports brief and standard conclusions with PDF citations, metadata and limitations", () => {
  for (const mode of [
    "standard",
    "brief_insufficient",
    "brief_policy",
  ] as const) {
    const markdown = screeningMarkdown(result(mode));
    for (const value of [
      "Bounded conclusion",
      "doc1",
      "page 3",
      "Product evidence",
      "Search unavailable",
      "Team introduction",
      "v1",
    ])
      expect(markdown).toContain(value);
  }
});

it.each(["zh", "en"] as const)("separates priority from quality and permits an empty policy in %s", (lang) => {
  const report = result();
  report.totalScore = 73;
  report.priorityScore = 78;
  report.policyBonus = 5;
  report.policyMatch = { ...report.policyMatch!, status: "focus", matchedRuleIds: ["focus"], evidenceIds: ["e1"] };
  const view = render(<ScreeningResultView result={report} lang={lang} />);
  expect(screen.getByText(lang === "zh" ? "实际定向检索 Twitter/X（含网页搜索）" : "Twitter/X targeted search used (including web search)")).toBeTruthy();
  expect(screen.getByText("73 / 100")).toBeTruthy();
  expect(screen.getByText("78 / 100")).toBeTruthy();
  expect(screen.getByText(lang === "zh" ? "质量分 73 + 策略加分 5，封顶 100" : "Quality 73 + policy bonus 5, capped at 100")).toBeTruthy();
  expect(screeningMarkdown(report)).toContain("**priorityScore:** 78");
  report.policyMatch = null;
  report.priorityScore = null;
  report.policyBonus = 0;
  view.rerender(<ScreeningResultView result={report} lang={lang} />);
  expect(screen.getByText("73 / 100")).toBeTruthy();
  expect(screen.queryByText(lang === "zh" ? "研究优先分" : "Research priority score")).toBeNull();
  expect(screen.queryByRole("heading", { name: lang === "zh" ? "策略匹配" : "Policy match" })).toBeNull();
  expect(screen.queryByText(lang === "zh" ? "独立策略状态" : "Independent policy status")).toBeNull();
  expect(screeningMarkdown(report)).not.toContain("policyVersion");
});

it("renders claims with verification, evidence anchors and safe source links; exports nested report data", () => {
  const report = result();
  report.evidence.push({
    id: "web",
    type: "third_party",
    title: "Independent source",
    url: "https://evidence.example/release",
    documentId: null,
    page: null,
    publishedAt: "2025-02-01",
    retrievedAt: "2026-11-05T00:00:00.000Z",
    quoteOrSummary: "Independent excerpt",
  });
  report.majorStrengths = [
    {
      text: "Independently documented launch",
      verification: "verified",
      evidenceIds: ["web"],
    },
  ];
  report.productAndTechnology = [
    {
      text: "Uncorroborated product claim",
      verification: "company_claim",
      evidenceIds: ["e1"],
    },
  ];
  report.team = {
    status: "evaluated",
    founders: [
      {
        name: "Fictional founder",
        title: "CTO",
        professionalFacts: [
          {
            text: "Public professional contribution",
            verification: "verified",
            evidenceIds: ["web"],
          },
        ],
        keyUnknowns: ["Prior role unknown"],
      },
    ],
    subScores: {
      founderMarketFit: 4,
      complementarity: null,
      trackRecord: 3,
      execution: 4,
      commitment: null,
    },
    strengths: [],
    weaknessesOrRisks: [],
    requiredMaterials: ["Technical biography"],
  };
  report.publicCompanyRefs = [
    {
      name: "Fictional public reference",
      website: "https://reference.example",
      category: "public_reference",
      sectorFit: "Sector overlap",
      productFit: "Related segment only",
      customerFit: "Same customer segment",
      notableDifferences: ["Not a seed valuation proxy"],
      financing: [],
      evidenceIds: ["web"],
      publicMarketData: {
        ticker: "FIXTURE",
        metricAsOf: "2025-12-31",
        revenueGrowth: 0.2,
        grossMargin: null,
        valuationMultiple: null,
        multipleType: null,
        notes: "Segment-only financial boundary",
        evidenceIds: ["web"],
      },
    },
  ];
  render(<ScreeningResultView result={report} lang="en" />);
  expect(screen.getAllByText("Independently verified").length).toBeGreaterThan(
    0,
  );
  expect(screen.getByText("Company claim")).toBeTruthy();
  expect(
    screen.getAllByRole("link", { name: "[web]" })[0].getAttribute("href"),
  ).toBe("#evidence-web");
  expect(
    screen
      .getByRole("link", { name: /https:\/\/evidence.example/ })
      .getAttribute("rel"),
  ).toContain("noopener");
  expect(screen.getByText(/PDF · page 3/)).toBeTruthy();
  report.company = {
    name: "Fixture Co",
    website: "https://fixture.example",
    aliases: [],
    productSummary: "Fixture product",
    targetCustomers: [],
    sectorPath: [],
    stage: "unknown",
    stageConfidence: null,
    identityConfidence: 0.9,
  };
  const { unmount } = render(<ScreeningResultView result={report} lang="zh" />);
  const stage = screen.getByText("融资阶段").nextElementSibling;
  expect(stage?.querySelector(".badge")?.textContent).toBe("未知");
  expect(screen.queryByText("未知 · 阶段暂定")).toBeNull();
  unmount();
  const markdown = screeningMarkdown(report);
  for (const value of [
    "Public professional contribution",
    "Technical biography",
    "https://evidence.example/release",
    "Not a seed valuation proxy",
    "Segment-only financial boundary",
    "2025-12-31",
    "Independent excerpt",
  ])
    expect(markdown).toContain(value);
});

it("omits demo controls and scenario fields in real mode and completes a single report", async () => {
  const fetcher = vi.fn(
    async (url: string, options?: RequestInit) =>
      new Response(
        JSON.stringify(
          url.endsWith("/auth/me")
            ? {
                user: { username: "admin", role: "admin" },
                csrfToken: "token",
                demoMode: false,
              }
            : url.endsWith("/result")
              ? result("brief_insufficient")
              : { id: "j", status: "completed", phase: "output" },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "English" }));
  fireEvent.change(await screen.findByLabelText(/Website URL/), {
    target: { value: "https://example.com" },
  });
  expect(screen.queryByLabelText(/Demo scenario/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Start screening/ }));
  await screen.findByRole("heading", { name: "Insufficient information" });
  const create = fetcher.mock.calls.find(
    ([url]) => url === "/api/screen/jobs",
  )!;
  expect(JSON.parse(create[1]!.body as string)).toEqual({
    website: "https://example.com",
    stage: "unknown",
  });
  expect(screen.getByLabelText(/Website URL/).matches(":disabled")).toBe(true);
});

it("rejects malformed report DTOs instead of rendering unvalidated claims", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/auth/me")
              ? {
                  user: { username: "admin", role: "admin" },
                  csrfToken: "token",
                  demoMode: false,
                }
              : url.endsWith("/result")
                ? { summary: "Unvalidated content" }
                : { id: "j", status: "completed", phase: "output" },
          ),
        ),
    ),
  );
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "English" }));
  fireEvent.change(await screen.findByLabelText(/Website URL/), {
    target: { value: "https://example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Start screening/ }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Report validation failed",
  );
  expect(screen.queryByText("Unvalidated content")).toBeNull();
});
