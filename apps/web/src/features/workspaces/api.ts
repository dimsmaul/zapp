import { request } from "@/lib/api";

export type Workspace = {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
};

export function listWorkspaces(token: string, signal: AbortSignal) {
  return request<{ items: Workspace[] }>("/workspaces", { token, signal });
}

export function createWorkspace(token: string, name: string) {
  return request<Workspace>("/workspaces", { method: "POST", token, body: { name } });
}

export function selectWorkspace(token: string, workspaceId: string) {
  return request<{ workspaceId: string }>("/session/workspace", {
    method: "PUT", token, body: { workspaceId },
  });
}
