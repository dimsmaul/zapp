import { request } from "@/lib/api";

export type DebuggerStatus = "not_uploaded" | "pending" | "processing" | "ready" | "failed";

export type ReportSummary = {
  id: string;
  title: string | null;
  description: string | null;
  /** `private` means every workspace member can open it; `restricted` limits it to people added to it. */
  visibility: "private" | "public" | "restricted";
  attachmentType: "video" | "screenshot";
  debuggerStatus: DebuggerStatus;
  createdAt: string;
  /** The folder the report is in, if any. */
  folderId: string | null;
  /** Short-lived signed media URL for list thumbnails; null when storage is not configured. */
  previewUrl: string | null;
  /** True when the caller may change this report (owner, admin, or the reporter). */
  canManage: boolean;
};

export type Visibility = ReportSummary["visibility"];

export type PlaybackReport = Pick<ReportSummary, "id" | "title" | "description" | "attachmentType" | "debuggerStatus" | "createdAt" | "visibility" | "canManage"> & {
  /** Reporter email; only sent to signed-in workspace members. */
  reporter: string | null;
  /** The report's workspace; only sent to signed-in workspace members. */
  workspaceId: string | null;
  attachmentUrl: string;
  captureContentType: string;
};

export type TimelineEvent = {
  id: string;
  category: "action" | "console" | "network";
  kind: string;
  offsetMs: number;
  data: Record<string, unknown> | null;
};

type Page<T> = { items: T[]; nextCursor: string | null };
type EventPage = Page<TimelineEvent> & { debuggerStatus: DebuggerStatus };
export type NetworkDetail = { event: TimelineEvent; details: Record<string, unknown> | null };
export type ReportAccess = { token?: string; shareToken?: string };

function pageSearch(cursor: string | null) {
  const params = new URLSearchParams({ limit: "30" });
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function listReports(token: string, cursor: string | null, signal: AbortSignal, folder?: string) {
  const search = new URLSearchParams(pageSearch(cursor));
  if (folder) search.set("folder", folder);
  return request<Page<ReportSummary>>(`/reports?${search}`, { token, signal });
}

/** Deletes a report and its recording. This cannot be undone. */
export function deleteReport(token: string, id: string) {
  return request<void>(`/reports/${encodeURIComponent(id)}`, { method: "DELETE", token });
}

/** Moves a report into a folder, or out of its folder when `folderId` is null. */
export function moveToFolder(token: string, id: string, folderId: string | null) {
  return request<ReportSummary>(`/reports/${encodeURIComponent(id)}/folder`, { method: "PUT", token, body: { folderId } });
}

export function getReport(id: string, access: ReportAccess, signal: AbortSignal) {
  return request<PlaybackReport>(`/reports/${encodeURIComponent(id)}`, { ...access, signal });
}

export function listEvents(id: string, view: "events" | "network", access: ReportAccess, cursor: string | null, signal: AbortSignal) {
  return request<EventPage>(`/reports/${encodeURIComponent(id)}/${view}?${pageSearch(cursor)}`, { ...access, signal });
}

export function getNetworkRequest(id: string, requestId: string, access: ReportAccess, signal: AbortSignal) {
  return request<NetworkDetail>(`/reports/${encodeURIComponent(id)}/network/${encodeURIComponent(requestId)}`, { ...access, signal });
}

export type AccessPerson = { userId: string; email: string | null; kind: "owner" | "member" };
export type Sharing = { visibility: Visibility; people: AccessPerson[] };

export function getSharing(token: string, id: string, signal: AbortSignal) {
  return request<Sharing>(`/reports/${encodeURIComponent(id)}/access`, { token, signal });
}

export function addPerson(token: string, id: string, userId: string) {
  return request<Sharing>(`/reports/${encodeURIComponent(id)}/access`, { method: "POST", token, body: { userId } });
}

export function removePerson(token: string, id: string, userId: string) {
  return request<Sharing>(`/reports/${encodeURIComponent(id)}/access/${encodeURIComponent(userId)}`, { method: "DELETE", token });
}

export function updateVisibility(token: string, id: string, visibility: Visibility) {
  return request<Pick<ReportSummary, "id" | "visibility">>(`/reports/${encodeURIComponent(id)}`, {
    method: "PATCH", token, body: { visibility },
  });
}

export function updateDetails(token: string, id: string, changes: { title?: string; description?: string }) {
  return request<Pick<ReportSummary, "id" | "title" | "description">>(`/reports/${encodeURIComponent(id)}`, {
    method: "PATCH", token, body: changes,
  });
}

export type ReportComment = {
  id: string;
  authorId: string;
  authorEmail: string | null;
  body: string;
  /** Position in the recording the comment refers to. */
  offsetMs: number | null;
  mentions: { userId: string; email: string | null }[];
  createdAt: string;
  canDelete: boolean;
};

export type CommentPage = { items: ReportComment[]; nextCursor: string | null };

export function listComments(token: string, id: string, cursor: string | null, signal: AbortSignal) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<CommentPage>(`/reports/${encodeURIComponent(id)}/comments${query}`, { token, signal });
}

export function addComment(token: string, id: string, input: { body: string; offsetMs?: number; mentions: string[] }) {
  return request<ReportComment>(`/reports/${encodeURIComponent(id)}/comments`, { method: "POST", token, body: input });
}

export function deleteComment(token: string, id: string, commentId: string) {
  return request<void>(`/reports/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE", token });
}
