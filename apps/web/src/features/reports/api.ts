import { request } from "@/lib/api";

export type DebuggerStatus = "not_uploaded" | "pending" | "processing" | "ready" | "failed";

export type ReportSummary = {
  id: string;
  title: string | null;
  description: string | null;
  visibility: "private" | "public";
  attachmentType: "video" | "screenshot";
  debuggerStatus: DebuggerStatus;
  createdAt: string;
};

export type PlaybackReport = Pick<ReportSummary, "id" | "title" | "description" | "attachmentType" | "debuggerStatus"> & {
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

export function listReports(token: string, cursor: string | null, signal: AbortSignal) {
  return request<Page<ReportSummary>>(`/reports?${pageSearch(cursor)}`, { token, signal });
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
