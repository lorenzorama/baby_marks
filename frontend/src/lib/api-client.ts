export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
  }
  if (!res.ok) {
    let data: unknown;
    try { data = await res.json(); } catch { /* ignore */ }
    const msg = (data as { error?: string })?.error ?? res.statusText;
    throw new ApiError(res.status, msg, data);
  }
  // 204 has no body at all (photo deletion), and res.json() would reject on it.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "POST", body: JSON.stringify(body) }),
  /** POST a body that is not JSON — the camera snapshot is a raw JPEG blob.
   *  Goes through request() so it gets the same 401 -> /login redirect and the
   *  same ApiError shape as every other call. */
  postRaw: <T>(url: string, body: BodyInit, contentType: string) =>
    request<T>(url, { method: "POST", body, headers: { "Content-Type": contentType } }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
