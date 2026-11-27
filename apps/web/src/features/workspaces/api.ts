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

export type Member = { userId: string; email: string; role: Workspace["role"] };

export type Invitation = { token: string; email: string; workspaceId: string; expiresAt: string };

export function listMembers(token: string, workspaceId: string, signal: AbortSignal) {
  return request<{ items: Member[] }>(`/workspaces/${encodeURIComponent(workspaceId)}/members`, { token, signal });
}

export function inviteMember(token: string, workspaceId: string, email: string) {
  return request<Invitation>(`/workspaces/${encodeURIComponent(workspaceId)}/invitations`, { method: "POST", token, body: { email } });
}

export function removeMember(token: string, workspaceId: string, userId: string) {
  return request<void>(`/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE", token });
}

export function acceptInvitation(token: string, invitation: string) {
  return request<{ workspaceId: string }>(`/invitations/${encodeURIComponent(invitation)}/accept`, { method: "POST", token });
}

export function selectWorkspace(token: string, workspaceId: string) {
  return request<{ workspaceId: string }>("/session/workspace", {
    method: "PUT", token, body: { workspaceId },
  });
}
