// @vitest-environment happy-dom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AdminSettings from "./AdminSettings";
import { defaultScoring } from "../shared/screening-schema";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mockSettings() {
  const models = {
    version: "1",
    models: [
      {
        id: "m",
        provider: "xai",
        modelId: "configured-model",
        baseUrl: "https://api.x.ai/v1",
        roles: ["research"],
        enabled: true,
        timeoutMs: 60000,
        maxOutputTokens: 4000,
        webSearch: true,
        xSearch: true,
        allowConfidential: false,
        apiKeyMasked: "****1234",
      },
    ],
  };
  const fetcher = vi.fn(
    async (url: string, options?: RequestInit) =>
      new Response(
        JSON.stringify(
          url.endsWith("/policy")
            ? { version: "1", prompt: "Existing policy", rules: [] }
            : url.endsWith("/scoring")
              ? defaultScoring
              : { ...models, version: options?.method === "PUT" ? "2" : "1" },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("previews masked model settings, preserves blank keys, saves versioned config", async () => {
  const fetcher = mockSettings();
  render(<AdminSettings token="csrf" lang="en" />);
  await screen.findByDisplayValue("configured-model");
  expect((screen.getByLabelText(/API key/) as HTMLInputElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("Base URL"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
  expect(
    screen.getByRole("heading", { name: "Review before saving" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
  await screen.findByText(/Saved. New jobs/);
  const put = fetcher.mock.calls.find(
    ([, options]) => options?.method === "PUT",
  )!;
  expect(JSON.parse(put[1]!.body as string).models[0]).not.toHaveProperty(
    "apiKey",
  );
  expect(JSON.parse(put[1]!.body as string).models[0]).not.toHaveProperty(
    "apiKeyMasked",
  );
  expect(JSON.parse(put[1]!.body as string).models[0]).not.toHaveProperty(
    "baseUrl",
  );
  expect(put[1]).toMatchObject({
    credentials: "same-origin",
    headers: { "x-csrf-token": "csrf" },
  });
  expect(screen.getByText("Version 2")).toBeTruthy();
});
it("requires valid per-stage sums before a scoring preview", async () => {
  mockSettings();
  render(<AdminSettings token="csrf" lang="en" />);
  await screen.findByDisplayValue("configured-model");
  fireEvent.click(screen.getByRole("button", { name: "Scoring" }));
  fireEvent.change(screen.getByLabelText("seed team"), {
    target: { value: "31" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("100%"),
  );
  expect(screen.queryByRole("button", { name: "Save new version" })).toBeNull();
});
