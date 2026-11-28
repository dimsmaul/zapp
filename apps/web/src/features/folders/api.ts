import { request } from "@/lib/api";

export type Folder = { id: string; name: string; reportCount: number; createdAt: string };

export function listFolders(token: string, signal?: AbortSignal) {
  return request<{ items: Folder[] }>("/folders", { token, signal });
}

export function createFolder(token: string, name: string) {
  return request<Folder>("/folders", { method: "POST", token, body: { name } });
}

export function renameFolder(token: string, id: string, name: string) {
  return request<Folder>(`/folders/${encodeURIComponent(id)}`, { method: "PATCH", token, body: { name } });
}

export function deleteFolder(token: string, id: string) {
  return request<void>(`/folders/${encodeURIComponent(id)}`, { method: "DELETE", token });
}
