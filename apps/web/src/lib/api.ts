export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = {
  method?: "GET" | "POST" | "PUT";
  token?: string;
  shareToken?: string;
  signal?: AbortSignal;
  body?: unknown;
};

export async function request<T>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", token, shareToken, signal, body } = options;
  const headers = new Headers({ Accept: "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (shareToken) headers.set("X-Zapp-Share-Token", shareToken);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    signal,
    cache: "no-store",
    redirect: "error",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : undefined;
  if (!response.ok) {
    throw new ApiError(response.status, data?.message ?? `Request failed (HTTP ${response.status}).`);
  }
  if (!isJson) throw new ApiError(response.status, "The API did not return JSON.");
  return data as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
