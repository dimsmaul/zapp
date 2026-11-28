import { request } from "@/lib/api";

export type RecordingLink = {
  id: string;
  name: string | null;
  folderId: string | null;
  folderName: string | null;
  url: string;
  createdAt: string;
};

/** What the /r/{token} page shows. Only members of the workspace can record into it. */
export type RecordingTarget = {
  workspaceId: string;
  workspaceName: string | null;
  folderId: string | null;
  folderName: string | null;
  member: boolean;
};

export function listRecordingLinks(token: string, signal?: AbortSignal) {
  return request<{ items: RecordingLink[] }>("/recording-links", { token, signal });
}

export function createRecordingLink(token: string, input: { name?: string; folderId?: string }) {
  return request<RecordingLink>("/recording-links", { method: "POST", token, body: input });
}

export function revokeRecordingLink(token: string, id: string) {
  return request<void>(`/recording-links/${encodeURIComponent(id)}`, { method: "DELETE", token });
}

export function lookupRecordingLink(token: string, linkToken: string, signal?: AbortSignal) {
  return request<RecordingTarget>(`/recording-links/by-token/${encodeURIComponent(linkToken)}`, { token, signal });
}
