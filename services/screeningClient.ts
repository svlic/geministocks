export type Session = {
  user: { username: string; role: "admin" } | null;
  csrfToken: string;
  demoMode: boolean;
};
export type Job = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: "reading" | "identity" | "policy" | "research" | "scoring" | "output";
  error?: string;
};
export async function screeningRequest<T>(
  path: string,
  csrfToken = "",
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(method !== "GET" ? { "x-csrf-token": csrfToken } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
export async function uploadDeck(file: File, token: string): Promise<string> {
  if (
    file.size > 25 * 1024 * 1024 ||
    !file.name.toLowerCase().endsWith(".pdf") ||
    file.type !== "application/pdf"
  )
    throw new Error("PDF only · maximum 25 MB / 40 pages");
  const upload = await screeningRequest<{
    uploadId: string;
    uploadUrl: string;
  }>("/api/uploads/init", token, "POST", {
    filename: file.name,
    size: file.size,
    mime: "application/pdf",
  });
  const url = new URL(upload.uploadUrl, window.location.origin);
  if (url.origin !== window.location.origin)
    throw new Error("Private upload must be same-origin");
  const response = await fetch(url.href, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "x-csrf-token": token, "content-type": "application/pdf" },
    body: file,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "PDF upload failed");
  }
  return upload.uploadId;
}
