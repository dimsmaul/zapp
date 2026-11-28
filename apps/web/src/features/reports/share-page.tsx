import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, getRouteApi, useLocation, useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, Home, LayoutGrid, Link2, LocateFixed, Search, Settings, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { EventRowsSkeleton, ReportPageSkeleton } from "@/components/skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isActive, useSession } from "@/features/auth/session";
import { ApiError, errorMessage } from "@/lib/api";
import { type DebuggerStatus, type PlaybackReport, type TimelineEvent, type Visibility, deleteReport, getNetworkRequest, getReport, listEvents, updateDetails, updateVisibility } from "./api";
import { type EventRow, EventTable } from "./event-table";
import { Comments, commentTimes, useComments } from "./comments";
import { InfoPanel } from "./info-panel";
import { NetworkInspector } from "./network-inspector";
import { ShareDialog } from "./share-dialog";
import { visibilityOptions } from "./visibility";
import { type NetworkRow, NetworkTable } from "./network-table";
import { type Marker, ReportPlayer, seekVideo } from "./player";
import { ReportHeading } from "./report-heading";

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

function isConsoleError(event: TimelineEvent) {
  return event.category === "console" && event.data?.level === "error";
}

function isNetworkError(event: TimelineEvent) {
  const status = event.data?.status ?? event.data?.statusCode;
  return event.category === "network" && (event.data?.failed === true || (typeof status === "number" && status >= 400));
}

const typeChips = [
  { key: "all", label: "All" },
  { key: "xhr", label: "Fetch/XHR" },
  { key: "ws", label: "WS" },
  { key: "js", label: "JS" },
  { key: "css", label: "CSS" },
  { key: "media", label: "Media" },
  { key: "font", label: "Font" },
  { key: "doc", label: "Doc" },
  { key: "other", label: "Other" },
] as const;
type TypeKey = (typeof typeChips)[number]["key"];

// Maps the DevTools resource type captured by the extension to a filter chip.
function resourceGroup(event: TimelineEvent): Exclude<TypeKey, "all"> {
  const type = String(event.data?.resourceType ?? "").toLowerCase();
  if (type === "xhr" || type === "fetch") return "xhr";
  if (type === "websocket" || event.data?.transport === "websocket") return "ws";
  if (type === "script") return "js";
  if (type === "stylesheet") return "css";
  if (type === "image" || type === "media") return "media";
  if (type === "font") return "font";
  if (type === "document") return "doc";
  return "other";
}

function eventRow(event: TimelineEvent): EventRow {
  const data = event.data;
  if (event.category === "action") {
    return {
      id: event.id, offsetMs: event.offsetMs, category: "action",
      verb: event.kind.endsWith("click") ? "Clicked" : event.kind.replace(/^action\./, ""),
      text: typeof data?.targetLabel === "string" ? data.targetLabel : "",
    };
  }
  if (event.category === "network") {
    const { method, status, path, host } = requestParts(event);
    const target = host === "—" ? path : `${host}${path}`;
    return {
      id: event.id, offsetMs: event.offsetMs, category: "network",
      level: isNetworkError(event) ? "error" : undefined,
      verb: method === "—" ? undefined : method,
      text: status === "—" ? target : `${target}  ${status}`,
    };
  }
  return {
    id: event.id, offsetMs: event.offsetMs, category: event.category,
    level: typeof data?.level === "string" ? data.level : undefined,
    text: typeof data?.message === "string" ? data.message : event.kind,
  };
}

function networkRow(event: TimelineEvent): NetworkRow {
  const { method, status, path, host, type } = requestParts(event);
  const duration = event.data?.durationMs;
  return {
    id: event.id,
    name: path.split("/").filter(Boolean).at(-1) ?? host,
    path, host, method, status, type,
    durationMs: typeof duration === "number" ? Math.round(duration) : null,
    offsetMs: event.offsetMs,
    error: isNetworkError(event),
  };
}

function requestParts(event: TimelineEvent) {
  const data = event.data;
  const raw = typeof data?.url === "string" ? data.url : "";
  let path = raw || event.kind;
  let host = "—";
  try {
    const url = new URL(raw);
    path = `${url.pathname}${url.search}`;
    host = url.host;
  } catch {
    // keep the raw value when the captured URL is relative or missing
  }
  const status = data?.status ?? data?.statusCode;
  return {
    method: typeof data?.method === "string" ? data.method.toUpperCase() : "—",
    status: typeof status === "number" ? String(status) : "—",
    path,
    host,
    type: typeof data?.resourceType === "string" ? data.resourceType.toLowerCase() : "—",
    time: typeof data?.durationMs === "number" ? `${Math.round(data.durationMs)} ms` : "—",
  };
}

export function SharePage() {
  const { id } = route.useParams();
  const hash = useLocation({ select: (location) => location.hash });
  const session = useSession((state) => state.session);
  const token = isActive(session) ? session.token : undefined;
  const shareToken = new URLSearchParams(hash.replace(/^#/, "")).get("share") || undefined;
  const access = { token, shareToken };
  const accessKey = ["report", id, token, shareToken] as const;
  const [view, setView] = useState<"console" | "network" | "action" | "info">("info");
  const eventView = view === "network" ? "network" : "events";
  const [selection, setSelection] = useState<{ reportId: string; requestId: string }>();
  const requestId = selection?.reportId === id ? selection.requestId : undefined;
  const video = useRef<HTMLVideoElement>(null);
  const [mediaError, setMediaError] = useState(false);
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeKey>("all");
  const [follow, setFollow] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);
  const [sharing, setSharing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const removeReport = useMutation({
    mutationFn: () => deleteReport(token!, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
      await queryClient.invalidateQueries({ queryKey: ["folders"] });
      await navigate({ to: "/reports" });
    },
  });
  const saveDetails = useMutation({
    mutationFn: (changes: { title: string; description: string }) => updateDetails(token!, id, changes),
    onSuccess: async (result) => {
      queryClient.setQueryData<PlaybackReport>(accessKey, (old) => old && { ...old, title: result.title, description: result.description });
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
  const setVisibility = useMutation({
    mutationFn: (value: Visibility) => updateVisibility(token!, id, value),
    // Patch only the cached visibility; refetching would re-sign the media URL and restart the player.
    onSuccess: (result) => queryClient.setQueryData<PlaybackReport>(accessKey, (old) => old && { ...old, visibility: result.visibility }),
  });

  const report = useQuery({
    queryKey: accessKey,
    queryFn: ({ signal }) => getReport(id, access, signal),
    staleTime: 4 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const commentsQuery = useComments(token ?? "", id, Boolean(token && report.data?.workspaceId));
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
  // The drawer keeps showing the last request while it slides out, so remember which one it was.
  const [lastRequestId, setLastRequestId] = useState<string>();
  const drawerId = requestId ?? lastRequestId;
  const detail = useQuery({
    queryKey: [...accessKey, "network-detail", drawerId],
    queryFn: ({ signal }) => getNetworkRequest(id, drawerId!, access, signal),
    enabled: view === "network" && Boolean(drawerId),
    retry: false,
  });
  const networkDetail = detail.data;

  const allEvents = events.data?.pages.flatMap((page) => page.items) ?? [];
  const term = filter.trim().toLowerCase();
  const rows = allEvents.filter((event) => {
    // Console is the full timeline: user actions, console messages, and the app's API calls.
    if (view === "action" && event.category !== "action") return false;
    if (view === "network" && errorsOnly && !isNetworkError(event)) return false;
    if (view === "network" && typeFilter !== "all" && resourceGroup(event) !== typeFilter) return false;
    return !term || `${event.kind} ${describe(event)}`.toLowerCase().includes(term);
  });
  // Points on the video's timeline: failed requests, console errors, and comments that mention a time.
  const errorMarkers = allEvents.filter((event) => isNetworkError(event) || isConsoleError(event)).slice(0, 24).map((event): Marker => {
    if (event.category === "console") {
      return { id: event.id, offsetMs: event.offsetMs, kind: "error", text: "!", label: `Console error: ${String(event.data?.message ?? "").slice(0, 120)}` };
    }
    const { method, status, path } = requestParts(event);
    return {
      id: event.id, offsetMs: event.offsetMs, kind: "error",
      text: status === "—" ? "ERR" : status,
      label: `${status === "—" ? "Request failed" : `HTTP ${status}`} · ${method} ${path}`,
    };
  });
  const commentMarkers = (commentsQuery.data?.pages.flatMap((page) => page.items) ?? []).flatMap((comment) =>
    commentTimes(comment).map((offsetMs, index): Marker => ({
      id: `comment-${comment.id}-${index}`, offsetMs, kind: "comment", text: "",
      label: `${comment.authorEmail ?? "Someone"}: ${comment.body.slice(0, 140)}`,
    })));
  const markers = [...errorMarkers, ...commentMarkers];
  const inspecting = view === "network" && Boolean(requestId);
  const [drawerMounted, setDrawerMounted] = useState(false);
  useEffect(() => {
    if (requestId) setLastRequestId(requestId);
    if (inspecting) {
      setDrawerMounted(true);
      return;
    }
    // Unmount only after the slide-out animation has finished.
    const timer = setTimeout(() => setDrawerMounted(false), 220);
    return () => clearTimeout(timer);
  }, [inspecting, requestId]);

  // Infinite scroll: load the next page whenever the sentinel below the list scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = events;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void fetchNextPage();
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, allEvents.length, view]);

  // Follow timeline: track the video's position and highlight the event that is currently playing.
  const isVideo = report.data?.attachmentType === "video";
  useEffect(() => {
    const player = video.current;
    if (!(follow && isVideo && player)) return;
    const sync = () => setPlaybackMs(player.currentTime * 1000);
    sync();
    player.addEventListener("timeupdate", sync);
    player.addEventListener("seeked", sync);
    return () => {
      player.removeEventListener("timeupdate", sync);
      player.removeEventListener("seeked", sync);
    };
  }, [follow, isVideo]);
  let activeId: string | undefined;
  if (follow && isVideo) {
    let latest = -1;
    for (const row of rows) {
      if (row.offsetMs <= playbackMs && row.offsetMs >= latest) {
        latest = row.offsetMs;
        activeId = row.id;
      }
    }
  }
  useEffect(() => {
    if (activeId) document.getElementById(`event-${activeId}`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  const debuggerStatus = events.data?.pages[0]?.debuggerStatus ?? report.data?.debuggerStatus;
  const unavailable = report.error instanceof ApiError && report.error.status === 404;

  if (report.isPending) {
    return <ReportPageSkeleton />;
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

  const { title, description, attachmentType, attachmentUrl, createdAt, reporter, visibility, canManage, workspaceId, environment } = report.data;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    // Same inset card as the signed-in layout (shadcn's sidebar "inset" look), just without a sidebar.
    <div className="min-h-svh bg-sidebar p-2 lg:h-svh">
    <main className="grid min-h-[calc(100svh-1rem)] overflow-hidden rounded-xl bg-background shadow-sm lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,3fr)_minmax(23rem,2fr)]">
      <section className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] lg:min-h-0" aria-label="Report recording">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          {token ? (
            <>
              <Button asChild variant="ghost"><Link to="/"><LayoutGrid />All Zapp</Link></Button>
            </>
          ) : <span className="flex items-center gap-2 text-sm font-medium"><img src="/logo.svg" alt="" className="size-7" />Zapp</span>}
        </div>
        <div className="flex items-center gap-2">
          <ButtonGroup>
            <Button onClick={() => void copyLink()}>{copyState === "copied" ? <Check /> : <Link2 />}{copyState === "copied" ? "Copied" : "Copy link"}</Button>
            {canManage && (
              <>
              <ButtonGroupSeparator className="bg-primary-foreground/25" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" aria-label="Change who can view"><ChevronDown /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>General access</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={visibility ?? "private"} onValueChange={(value) => setVisibility.mutate(value as Visibility)}>
                    {visibilityOptions.map(({ value, label, Icon }) => (
                      <DropdownMenuRadioItem key={value} value={value}><Icon />{label}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setSharing(true)}><Settings />Share settings</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmingDelete(true)}><Trash2 />Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </>
            )}
          </ButtonGroup>
          {setVisibility.isError && <span role="alert" className="text-sm text-destructive">{errorMessage(setVisibility.error)}</span>}
          {copyState === "failed" && <span role="status" className="text-sm">Copy the URL from the address bar.</span>}
        </div>
      </header>
      <div className="min-w-0 lg:overflow-y-auto">
            {attachmentType === "screenshot" ? (
              <div className="grid place-items-center px-4 pt-4 sm:px-6 sm:pt-6">
                  {mediaError && <Alert variant="destructive"><AlertDescription>
                    The screenshot could not be loaded.
                    <Button variant="outline" size="sm" disabled={report.isFetching} onClick={() => void report.refetch()}>Reload</Button>
                  </AlertDescription></Alert>}
                  <img className="max-h-[78svh] max-w-full rounded-lg object-contain" src={attachmentUrl} alt={title ? `Screenshot for ${title}` : "Captured screenshot"} onLoad={() => setMediaError(false)} onError={() => setMediaError(true)} />
              </div>
            ) : (
              <div className="px-4 pt-4 sm:px-6 sm:pt-6">
                <ReportPlayer
                  video={video} src={attachmentUrl} markers={markers}
                  durationHint={Math.ceil((allEvents.at(-1)?.offsetMs ?? 0) / 1000)}
                  onReload={async () => {
                    const result = await report.refetch();
                    return result.isError ? undefined : result.data?.attachmentUrl;
                  }}
                />
              </div>
            )}
            <ReportHeading
              title={title} description={description} reporter={reporter} createdAt={createdAt}
              canEdit={canManage} onSave={(changes) => saveDetails.mutateAsync(changes)}
            />
            {token && workspaceId && (
              <Comments
                reportId={id} token={token} workspaceId={workspaceId}
                video={video} isVideo={attachmentType === "video"}
                onSeek={(seconds) => seekVideo(video.current, seconds)}
              />
            )}
        </div>
        </section>
        <aside className="relative grid min-w-0 grid-rows-[auto_minmax(0,1fr)] border-t lg:min-h-0 lg:border-l lg:border-t-0" aria-label="Report diagnostics">
          <header className="flex min-h-16 flex-wrap items-center gap-x-3 border-b px-4 py-3">
            <h2 className="font-semibold">DevTools</h2>
            {debuggerStatus && <p className="text-xs text-muted-foreground">{debuggerMessage[debuggerStatus]}</p>}
          </header>
          <div className="flex min-h-0 min-w-0 flex-col">
            <Tabs className="min-h-0 flex-1 gap-0" value={view} onValueChange={(value) => {
              if (value === "console" || value === "network" || value === "action" || value === "info") setView(value);
            }}>
              <div className="shrink-0 border-b px-4 pt-3 pb-2">
              <TabsList variant="line" aria-label="Debugger views" className="h-auto">
                {(["info", "console", "network", "action"] as const).map((tab) => (
                  <TabsTrigger key={tab} value={tab} className="flex-none rounded-md border-transparent px-3 py-1.5 capitalize">{tab}</TabsTrigger>
                ))}
              </TabsList>
              </div>
              <TabsContent value={view} className="flex min-h-0 flex-1 flex-col">
                {view === "info" ? (
                  <div className="min-h-0 flex-1 overflow-auto max-lg:max-h-[70svh]"><InfoPanel environment={environment} createdAt={createdAt} /></div>
                ) : (<>
                <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
                  <div className="relative min-w-32 flex-1">
                    <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
                    <Input className="bg-muted/50 pl-8" aria-label="Filter loaded events" placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
                  </div>
                  {view === "network" && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />
                      Errors only
                    </label>
                  )}
                  {attachmentType === "video" && (
                    <Button size="sm" variant={follow ? "secondary" : "outline"} aria-pressed={follow} onClick={() => setFollow((value) => !value)}>
                      <LocateFixed />
                    </Button>
                  )}
                </div>
                {view === "network" && (
                  <div className="flex flex-wrap gap-1.5 border-b px-4 py-2" role="group" aria-label="Resource type">
                    {typeChips.map(({ key, label }) => (
                      <Button key={key} size="xs" variant={typeFilter === key ? "default" : "outline"} aria-pressed={typeFilter === key} onClick={() => setTypeFilter(key)}>{label}</Button>
                    ))}
                  </div>
                )}
                {/* Filter, chips, and the table header stay put; only the rows scroll. */}
                <div className="min-h-0 flex-1 overflow-auto max-lg:max-h-[70svh]">
                {events.isPending && <EventRowsSkeleton label="Loading diagnostic events" />}
                {events.isError && <div className="p-4"><Alert variant="destructive"><AlertDescription>{errorMessage(events.error)}</AlertDescription></Alert></div>}
                {events.isSuccess && rows.length === 0 && (
                  <Empty><EmptyHeader><EmptyTitle>No events in this view</EmptyTitle><EmptyDescription>{view === "action" && events.hasNextPage ? "Loading more entries to find user actions…" : "Captured events appear here when available."}</EmptyDescription></EmptyHeader></Empty>
                )}
                {rows.length > 0 && view === "network" && (
                  <NetworkTable
                    rows={rows.map(networkRow)}
                    selectedId={requestId}
                    activeId={activeId}
                    onSelect={(rowId) => setSelection({ reportId: id, requestId: rowId })}
                  />
                )}
                {rows.length > 0 && view !== "network" && (
                  <EventTable
                    rows={rows.map(eventRow)}
                    label={view === "console" ? "Console" : "User actions"}
                    activeId={activeId}
                    onSelect={attachmentType === "video" ? (row) => seekVideo(video.current, row.offsetMs / 1000) : undefined}
                  />
                )}
                {events.hasNextPage && <div ref={sentinel} className="p-4" aria-live="polite">
                  {events.isFetchingNextPage && <EventRowsSkeleton label="Loading more events" rows={3} />}
                </div>}
                </div>
                </>)}
              </TabsContent>
            </Tabs>
          </div>
          {(inspecting || drawerMounted) && (
            <div
              data-state={inspecting ? "open" : "closed"}
              className="absolute inset-y-0 right-0 z-20 w-4/5 border-l bg-background shadow-2xl duration-200 fill-mode-forwards max-sm:w-full data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right motion-reduce:animate-none"
            >
              <NetworkInspector
                key={drawerId}
                detail={networkDetail}
                loading={detail.isPending}
                error={detail.error}
                onClose={() => setSelection(undefined)}
                onSeek={attachmentType === "video" ? (seconds) => seekVideo(video.current, seconds) : undefined}
              />
            </div>
          )}
        </aside>
    </main>
    <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{title || "Untitled report"}”?</DialogTitle>
          <DialogDescription>The recording, its console and network logs, and its comments are deleted for everyone. This cannot be undone.</DialogDescription>
        </DialogHeader>
        {removeReport.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(removeReport.error)}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
          <Button variant="destructive" disabled={removeReport.isPending} onClick={() => removeReport.mutate()}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {canManage && token && workspaceId && (
      <ShareDialog
        open={sharing}
        onOpenChange={setSharing}
        reportId={id}
        title={title}
        token={token}
        workspaceId={workspaceId}
        visibility={visibility ?? "private"}
        onVisibility={(value) => setVisibility.mutate(value)}
      />
    )}
    </div>
  );
}
