import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useLocation } from "@tanstack/react-router";
import { ArrowLeft, AudioLines, Check, CircleAlert, Code2, Link2, List, Search } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isActive, useSession } from "@/features/auth/session";
import { ApiError, errorMessage } from "@/lib/api";
import { type DebuggerStatus, type TimelineEvent, getNetworkRequest, getReport, listEvents } from "./api";
import { clock, ReportPlayer, seekVideo } from "./player";

const route = getRouteApi("/s/$id");

const debuggerMessage: Record<DebuggerStatus, string> = {
  pending: "Diagnostic data is queued for processing.",
  processing: "Diagnostic data is processing.",
  ready: "Diagnostic data is ready.",
  failed: "Diagnostic data could not be processed.",
  not_uploaded: "This capture has no diagnostic upload.",
};

function describe(event: TimelineEvent) {
  const data = event.data;
  if (!data) return event.kind;
  const fields = event.category === "network"
    ? [data.method, data.status, data.url ?? data.topic ?? data.eventName]
    : [data.level, data.message ?? data.targetLabel];
  return fields.filter((value) => typeof value === "string" || typeof value === "number").join(" ") || event.kind;
}

function isNetworkError(event: TimelineEvent) {
  const status = event.data?.status ?? event.data?.statusCode;
  return event.category === "network" && (event.data?.failed === true || (typeof status === "number" && status >= 400));
}

export function SharePage() {
  const { id } = route.useParams();
  const hash = useLocation({ select: (location) => location.hash });
  const session = useSession((state) => state.session);
  const token = isActive(session) ? session.token : undefined;
  const shareToken = new URLSearchParams(hash.replace(/^#/, "")).get("share") || undefined;
  const access = { token, shareToken };
  const accessKey = ["report", id, token, shareToken] as const;
  const [view, setView] = useState<"timeline" | "console" | "network">("timeline");
  const eventView = view === "network" ? "network" : "events";
  const [selection, setSelection] = useState<{ reportId: string; requestId: string }>();
  const requestId = selection?.reportId === id ? selection.requestId : undefined;
  const video = useRef<HTMLVideoElement>(null);
  const [mediaError, setMediaError] = useState(false);
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);

  const report = useQuery({
    queryKey: accessKey,
    queryFn: ({ signal }) => getReport(id, access, signal),
    staleTime: 4 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const events = useInfiniteQuery({
    queryKey: [...accessKey, eventView],
    queryFn: ({ pageParam, signal }) => listEvents(id, eventView, access, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.pages[0]?.debuggerStatus;
      return status === "pending" || status === "processing" ? 3000 : false;
    },
  });
  const detail = useQuery({
    queryKey: [...accessKey, "network-detail", requestId],
    queryFn: ({ signal }) => getNetworkRequest(id, requestId!, access, signal),
    enabled: view === "network" && Boolean(requestId),
    retry: false,
  });
  const networkDetail = detail.data;

  const allEvents = events.data?.pages.flatMap((page) => page.items) ?? [];
  const term = filter.trim().toLowerCase();
  const rows = allEvents.filter((event) => {
    if (view === "console" && event.category !== "console") return false;
    if (view === "network" && errorsOnly && !isNetworkError(event)) return false;
    return !term || `${event.kind} ${describe(event)}`.toLowerCase().includes(term);
  });
  const markers = allEvents.filter(isNetworkError).slice(0, 16).map((event) => {
    const status = event.data?.status ?? event.data?.statusCode;
    return { id: event.id, offsetMs: event.offsetMs, label: typeof status === "number" ? `HTTP ${status}` : "Request failed" };
  });
  const debuggerStatus = events.data?.pages[0]?.debuggerStatus ?? report.data?.debuggerStatus;
  const unavailable = report.error instanceof ApiError && report.error.status === 404;

  if (report.isPending) {
    return <main className="mx-auto max-w-5xl p-6"><Spinner aria-label="Loading the report" /></main>;
  }
  if (!report.data || unavailable) {
    return (
      <main className="mx-auto grid max-w-xl gap-4 p-6">
        <Alert variant="destructive">
          <AlertDescription>{unavailable ? "This report is unavailable. Check the share link or ask the workspace for access." : errorMessage(report.error)}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link to="/">Back to Zapp</Link></Button>
          {!unavailable && <Button variant="outline" onClick={() => void report.refetch()}>Try again</Button>}
        </div>
      </main>
    );
  }

  const { title, description, attachmentType, attachmentUrl } = report.data;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <main className="mx-auto grid max-w-[1600px] gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          {token && <Button asChild variant="outline" size="icon" aria-label="Back to workspace"><Link to="/"><ArrowLeft /></Link></Button>}
          <div>
            <p className="text-xs font-medium text-muted-foreground">Zapp report</p>
            <h1 className="text-xl font-semibold">{title || "Untitled report"}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void copyLink()}>{copyState === "copied" ? <Check /> : <Link2 />}{copyState === "copied" ? "Copied" : "Copy link"}</Button>
          {copyState === "failed" && <span role="status" className="text-sm">Copy the URL from the address bar.</span>}
        </div>
      </header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="grid min-w-0 gap-4" aria-label="Recorded capture">
            {attachmentType === "screenshot" ? (
              <Card>
                <CardHeader><CardTitle>Screenshot</CardTitle></CardHeader>
                <CardContent>
                  {mediaError && <Alert variant="destructive"><AlertDescription>
                    The screenshot could not be loaded.
                    <Button variant="outline" size="sm" disabled={report.isFetching} onClick={() => void report.refetch()}>Reload</Button>
                  </AlertDescription></Alert>}
                  <img src={attachmentUrl} alt={title ? `Screenshot for ${title}` : "Captured screenshot"} onLoad={() => setMediaError(false)} onError={() => setMediaError(true)} />
                </CardContent>
              </Card>
            ) : (
              <ReportPlayer
                video={video} src={attachmentUrl} markers={markers}
                durationHint={Math.ceil((allEvents.at(-1)?.offsetMs ?? 0) / 1000)}
                onReload={async () => {
                  const result = await report.refetch();
                  return result.isError ? undefined : result.data?.attachmentUrl;
                }}
              />
            )}
            {description && <Card><CardHeader><CardTitle>Report notes</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap">{description}</p></CardContent></Card>}
        </section>
        <Card>
          <CardHeader>
            <CardTitle>Debugger</CardTitle>
            {debuggerStatus && <CardDescription>{debuggerMessage[debuggerStatus]}</CardDescription>}
          </CardHeader>
          <CardContent>
            <Tabs value={view} onValueChange={(value) => {
              if (value === "timeline" || value === "console" || value === "network") setView(value);
            }}>
              <TabsList aria-label="Debugger views">
                <TabsTrigger value="timeline"><List />Timeline</TabsTrigger>
                <TabsTrigger value="console"><Code2 />Console</TabsTrigger>
                <TabsTrigger value="network"><AudioLines />Network</TabsTrigger>
              </TabsList>
              <TabsContent value={view}>
                <div className="flex flex-wrap items-center gap-2 py-3">
                  <Search size={16} aria-hidden="true" />
                  <div className="min-w-32 flex-1">
                    <Input aria-label="Filter loaded events" placeholder="Filter events" value={filter} onChange={(event) => setFilter(event.target.value)} />
                  </div>
                  {view === "network" && <Button variant={errorsOnly ? "secondary" : "outline"} aria-pressed={errorsOnly} onClick={() => setErrorsOnly((value) => !value)}><CircleAlert />Errors only</Button>}
                </div>
                {events.isPending && <Spinner aria-label="Loading diagnostic events" />}
                {events.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(events.error)}</AlertDescription></Alert>}
                {events.isSuccess && rows.length === 0 && (
                  <Empty><EmptyHeader><EmptyTitle>No events in this view</EmptyTitle><EmptyDescription>{view === "console" && events.hasNextPage ? "Load more timeline entries to find console messages." : "Captured events appear here when available."}</EmptyDescription></EmptyHeader></Empty>
                )}
                {rows.length > 0 && (
                  <div className="max-h-[60svh] overflow-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Time</TableHead><TableHead>{view === "network" ? "Request" : "Event"}</TableHead>{view === "network" && <><TableHead>Status</TableHead><TableHead>Detail</TableHead></>}
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell>
                            {attachmentType === "video" ? (
                              <Button variant="link" size="sm" onClick={() => seekVideo(video.current, event.offsetMs / 1000)}>{clock(event.offsetMs / 1000)}</Button>
                            ) : clock(event.offsetMs / 1000)}
                          </TableCell>
                          <TableCell>
                            <div className="grid max-w-sm justify-items-start gap-1 whitespace-normal">
                              <Badge variant="secondary">{event.kind}</Badge>
                              <span className="break-all">{describe(event)}</span>
                            </div>
                          </TableCell>
                          {view === "network" && <>
                            <TableCell><Badge variant={isNetworkError(event) ? "destructive" : "secondary"}>{String(event.data?.status ?? event.data?.statusCode ?? "—")}</Badge></TableCell>
                            <TableCell>
                              <Button size="sm" variant="outline" aria-pressed={requestId === event.id} onClick={() => setSelection({ reportId: id, requestId: event.id })}>Inspect</Button>
                            </TableCell>
                          </>}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
                {events.hasNextPage && <div className="mt-3">
                  <Button variant="outline" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>Load more</Button>
                </div>}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      <Dialog open={view === "network" && Boolean(requestId)} onOpenChange={(open) => { if (!open) setSelection(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request details</DialogTitle>
            <DialogDescription>Captured request, response, and timing data.</DialogDescription>
          </DialogHeader>
          {detail.isPending && <Spinner aria-label="Loading the request" />}
          {detail.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(detail.error)}</AlertDescription></Alert>}
          {networkDetail && (
            <Tabs key={requestId} defaultValue={networkDetail.details?.request != null ? "request" : "all"}>
              <TabsList aria-label="Request detail views">
                {networkDetail.details?.request != null && <TabsTrigger value="request">Request</TabsTrigger>}
                {networkDetail.details?.response != null && <TabsTrigger value="response">Response</TabsTrigger>}
                {networkDetail.details?.timing != null && <TabsTrigger value="timing">Timing</TabsTrigger>}
                <TabsTrigger value="all">All data</TabsTrigger>
              </TabsList>
              {(["request", "response", "timing", "all"] as const).map((part) => {
                const data = part === "all" ? (networkDetail.details ?? networkDetail.event.data) : networkDetail.details?.[part];
                if (data == null && part !== "all") return null;
                return <TabsContent key={part} value={part}><pre className="max-h-72 overflow-auto break-all whitespace-pre-wrap text-sm">{JSON.stringify(data, null, 2)}</pre></TabsContent>;
              })}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
