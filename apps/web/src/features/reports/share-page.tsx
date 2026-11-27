import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useLocation } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isActive, useSession } from "@/features/auth/session";
import { ApiError, errorMessage } from "@/lib/api";
import { type DebuggerStatus, type TimelineEvent, getNetworkRequest, getReport, listEvents } from "./api";

const route = getRouteApi("/s/$id");

const debuggerMessage: Record<DebuggerStatus, string> = {
  pending: "Diagnostic data is queued for processing.",
  processing: "Diagnostic data is processing.",
  ready: "Diagnostic data is ready.",
  failed: "Diagnostic data could not be processed.",
  not_uploaded: "This capture has no diagnostic upload.",
};

function clock(seconds: number) {
  const whole = Math.floor(Math.max(0, seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function describe(event: TimelineEvent) {
  const data = event.data;
  if (!data) return event.kind;
  const fields = event.category === "network"
    ? [data.method, data.status, data.url ?? data.topic ?? data.eventName]
    : [data.level, data.message ?? data.targetLabel];
  return fields.filter((value) => typeof value === "string" || typeof value === "number").join(" ") || event.kind;
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
  const mediaArea = useRef<HTMLDivElement>(null);
  const resumeAt = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekableEnd, setSeekableEnd] = useState(0);
  const [speed, setSpeed] = useState("1");
  const [mediaError, setMediaError] = useState(false);

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
  const rows = view === "console" ? allEvents.filter((event) => event.category === "console") : allEvents;
  const debuggerStatus = events.data?.pages[0]?.debuggerStatus ?? report.data?.debuggerStatus;
  const seekLimit = duration || Math.max(seekableEnd, Math.ceil((allEvents.at(-1)?.offsetMs ?? 0) / 1000));
  const unavailable = report.error instanceof ApiError && report.error.status === 404;

  function seek(seconds: number) {
    if (!video.current) return;
    video.current.currentTime = duration ? Math.min(seconds, duration) : seconds;
    setCurrent(video.current.currentTime);
  }

  async function togglePlayback() {
    if (!video.current) return;
    if (!video.current.paused) {
      video.current.pause();
      return;
    }
    try {
      await video.current.play();
    } catch {
      setMediaError(true);
    }
  }

  async function fullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await mediaArea.current?.requestFullscreen().catch(() => {});
  }

  async function refreshMedia() {
    resumeAt.current = video.current?.currentTime ?? 0;
    setMediaError(false);
    const result = await report.refetch();
    if (!result.isError && result.data?.attachmentUrl === report.data?.attachmentUrl) video.current?.load();
  }

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

  return (
    <main className="mx-auto grid max-w-7xl gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold">{title || "Untitled report"}</h1>
          {description && <p className="whitespace-pre-wrap">{description}</p>}
        </div>
        {token && <Button asChild variant="outline"><Link to="/">Workspace</Link></Button>}
      </header>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{attachmentType === "video" ? "Recording" : "Screenshot"}</CardTitle></CardHeader>
          <CardContent>
            {mediaError && (
              <div className="mb-3 grid gap-2">
                <Alert variant="destructive"><AlertDescription>The capture could not be loaded.</AlertDescription></Alert>
                <Button variant="outline" disabled={report.isFetching} onClick={() => void refreshMedia()}>Reload capture</Button>
              </div>
            )}
            {attachmentType === "screenshot" ? (
              <img src={attachmentUrl} alt={title ? `Screenshot for ${title}` : "Captured screenshot"} onLoad={() => setMediaError(false)} onError={() => setMediaError(true)} />
            ) : (
              <div ref={mediaArea} className="grid gap-3">
                <video
                  ref={video}
                  src={attachmentUrl}
                  preload="metadata"
                  playsInline
                  className="max-h-[70vh] w-full"
                  onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                  onProgress={(event) => {
                    const { seekable } = event.currentTarget;
                    if (seekable.length) {
                      const end = seekable.end(seekable.length - 1);
                      if (Number.isFinite(end)) setSeekableEnd(end);
                    }
                  }}
                  onTimeUpdate={(event) => setCurrent(Math.floor(event.currentTarget.currentTime))}
                  onLoadedMetadata={(event) => {
                    event.currentTarget.playbackRate = Number(speed);
                    const position = resumeAt.current;
                    resumeAt.current = 0;
                    if (position > 0) seek(position);
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onError={() => setMediaError(true)}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => void togglePlayback()}>{playing ? "Pause" : "Play"}</Button>
                  <div className="min-w-24 flex-1">
                    <Slider min={0} max={Math.max(1, seekLimit)} step={1} value={[Math.min(current, seekLimit)]} disabled={!seekLimit} onValueChange={([value]) => seek(value)} aria-label="Playback position" />
                  </div>
                  <span className="tabular-nums">{clock(current)} / {duration ? clock(duration) : "—"}</span>
                  <Select value={speed} onValueChange={(value) => {
                    setSpeed(value);
                    if (video.current) video.current.playbackRate = Number(value);
                  }}>
                    <SelectTrigger size="sm" aria-label="Playback speed"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["0.5", "1", "1.5", "2"].map((rate) => <SelectItem key={rate} value={rate}>{rate}×</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => void fullscreen()}>Fullscreen</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
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
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="console">Console</TabsTrigger>
                <TabsTrigger value="network">Network</TabsTrigger>
              </TabsList>
              <TabsContent value={view}>
                {events.isPending && <Spinner aria-label="Loading diagnostic events" />}
                {events.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(events.error)}</AlertDescription></Alert>}
                {events.isSuccess && rows.length === 0 && (
                  <Empty><EmptyHeader><EmptyTitle>No events in this view</EmptyTitle><EmptyDescription>{view === "console" && events.hasNextPage ? "Load more timeline entries to find console messages." : "Captured events appear here when available."}</EmptyDescription></EmptyHeader></Empty>
                )}
                {rows.length > 0 && (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Time</TableHead><TableHead>Event</TableHead>{view === "network" && <TableHead>Request</TableHead>}
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell>
                            {attachmentType === "video" ? (
                              <Button variant="link" size="sm" onClick={() => seek(event.offsetMs / 1000)}>{clock(event.offsetMs / 1000)}</Button>
                            ) : clock(event.offsetMs / 1000)}
                          </TableCell>
                          <TableCell>
                            <div className="grid max-w-sm justify-items-start gap-1 whitespace-normal">
                              <Badge variant="secondary">{event.kind}</Badge>
                              <span className="break-all">{describe(event)}</span>
                            </div>
                          </TableCell>
                          {view === "network" && <TableCell>
                            <Button size="sm" variant="outline" aria-pressed={requestId === event.id} onClick={() => setSelection({ reportId: id, requestId: event.id })}>Inspect</Button>
                          </TableCell>}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
