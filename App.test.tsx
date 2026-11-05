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
it("locks submitted inputs, displays server phase and supports cancellation", async () => {
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
              phase: "identity",
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
  expect(screen.getByRole("status").textContent).toContain("Confirm identity");
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
  ["failed", "Technical failure"],
  ["partial_error", "Partial technical failure"],
])("distinguishes %s", (mode, title) => {
  render(<ScreeningResultView result={result(mode)} lang="en" />);
  expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  if (mode.startsWith("brief"))
    expect(
      screen.queryByRole("heading", { name: "Direct private comparables" }),
    ).toBeNull();
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
