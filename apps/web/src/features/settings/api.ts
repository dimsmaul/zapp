import { request } from "@/lib/api";

export type AgentToken = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

/** The secret is only present in the response that creates the token. */
export type CreatedToken = AgentToken & { token: string };

export function listTokens(token: string, signal: AbortSignal) {
  return request<{ items: AgentToken[] }>("/tokens", { token, signal });
}

export function createToken(token: string, name: string, expiresInDays: number | null) {
  return request<CreatedToken>("/tokens", {
    method: "POST", token, body: expiresInDays === null ? { name } : { name, expiresInDays },
  });
}

export function revokeToken(token: string, id: string) {
  return request<void>(`/tokens/${encodeURIComponent(id)}`, { method: "DELETE", token });
}
