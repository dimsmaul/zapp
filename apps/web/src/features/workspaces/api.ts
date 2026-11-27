import { request } from "@/lib/api";

export type Workspace = {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
  /** Visibility for new reports when the capture does not ask for one. */
  defaultVisibility?: "restricted" | "private" | "public" | null;
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

export type PendingInvitation = { id: string; email: string; expiresAt: string };

export function listInvitations(token: string, workspaceId: string, signal: AbortSignal) {
  return request<{ items: PendingInvitation[] }>(`/workspaces/${encodeURIComponent(workspaceId)}/invitations`, { token, signal });
}

export function revokeInvitation(token: string, workspaceId: string, invitationId: string) {
  return request<void>(`/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE", token });
}

export function changeRole(token: string, workspaceId: string, userId: string, role: "admin" | "member") {
  return request<{ userId: string; role: string }>(`/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, {
    method: "PATCH", token, body: { role },
  });
}

export function updateWorkspace(token: string, workspaceId: string, changes: { name?: string; defaultVisibility?: "restricted" | "private" | "public" }) {
  return request<{ id: string }>(`/workspaces/${encodeURIComponent(workspaceId)}`, { method: "PATCH", token, body: changes });
}

export function leaveWorkspace(token: string, workspaceId: string) {
  return request<void>(`/workspaces/${encodeURIComponent(workspaceId)}/leave`, { method: "POST", token });
}

export function deleteWorkspace(token: string, workspaceId: string) {
  return request<void>(`/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE", token });
}

export type CaptureKey = { id: string; allowedOrigins: string[]; status: "active" | "revoked" };

/** The key itself is only present in the response that creates it. */
export type CreatedKey = CaptureKey & { key: string };

export function listKeys(token: string, workspaceId: string, signal: AbortSignal) {
  return request<{ items: CaptureKey[] }>(`/workspaces/${encodeURIComponent(workspaceId)}/capture-keys`, { token, signal });
}

export function createKey(token: string, workspaceId: string, allowedOrigins: string[]) {
  return request<CreatedKey>(`/workspaces/${encodeURIComponent(workspaceId)}/capture-keys`, { method: "POST", token, body: { allowedOrigins } });
}

export function updateKey(token: string, workspaceId: string, keyId: string, allowedOrigins: string[]) {
  return request<CaptureKey>(`/workspaces/${encodeURIComponent(workspaceId)}/capture-keys/${encodeURIComponent(keyId)}`, {
    method: "PATCH", token, body: { allowedOrigins },
  });
}

export function revokeKey(token: string, workspaceId: string, keyId: string) {
  return request<void>(`/workspaces/${encodeURIComponent(workspaceId)}/capture-keys/${encodeURIComponent(keyId)}`, { method: "DELETE", token });
}

export function selectWorkspace(token: string, workspaceId: string) {
  return request<{ workspaceId: string }>("/session/workspace", {
    method: "PUT", token, body: { workspaceId },
  });
}
