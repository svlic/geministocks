// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { screeningRequest, uploadDeck } from "./screeningClient";
afterEach(() => vi.unstubAllGlobals());
it("uses authenticated CSRF-protected JSON mutations and preserves server errors", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    screeningRequest("/api/admin/policy", "csrf", "PUT", { prompt: "policy" }),
  ).rejects.toThrow("Forbidden");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/admin/policy",
    expect.objectContaining({
      credentials: "same-origin",
      method: "PUT",
      headers: { "x-csrf-token": "csrf", "content-type": "application/json" },
      body: '{"prompt":"policy"}',
    }),
  );
});
it("initializes a private upload then streams raw PDF, not JSON or multipart", async () => {
  const file = new File(["%PDF-1.7 fixture"], "deck.pdf", {
    type: "application/pdf",
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ uploadId: "u", uploadUrl: "/private-upload/u" }),
      ),
    )
    .mockResolvedValueOnce(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  expect(await uploadDeck(file, "csrf")).toBe("u");
  expect(fetcher.mock.calls[1][1]).toMatchObject({
    method: "PUT",
    credentials: "same-origin",
    headers: { "x-csrf-token": "csrf", "content-type": "application/pdf" },
    body: file,
  });
});
it("never sends credentials or CSRF to an external upload URL", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          uploadId: "u",
          uploadUrl: "https://untrusted.example/upload",
        }),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    uploadDeck(
      new File(["%PDF"], "deck.pdf", { type: "application/pdf" }),
      "csrf",
    ),
  ).rejects.toThrow("same-origin");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
