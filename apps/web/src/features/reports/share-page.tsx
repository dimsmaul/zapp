import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useLocation } from "@tanstack/react-router";
import { ArrowLeft, Check, Home, LayoutGrid, Link2, Search } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const relativeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000], ["month", 2_592_000], ["day", 86_400], ["hour", 3600], ["minute", 60],
];

function timeAgo(value: string) {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of relativeUnits) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
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
  const [view, setView] = useState<"timeline" | "console" | "network">("timeline");
  const eventView = view === "network" ? "network" : "events";
  const [selection, setSelection] = useState<{ reportId: string; requestId: string }>();
  const requestId = selection?.reportId === id ? selection.requestId : undefined;
  const video = useRef<HTMLVideoElement>(null);
  const [mediaError, setMediaError] = useState(false);
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeKey>("all");
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
    if (view === "network" && typeFilter !== "all" && resourceGroup(event) !== typeFilter) return false;
    return !term || `${event.kind} ${describe(event)}`.toLowerCase().includes(term);
  });
  const markers = allEvents.filter(isNetworkError).slice(0, 16).map((event) => {
    const status = event.data?.status ?? event.data?.statusCode;
    return {
      id: event.id,
      offsetMs: event.offsetMs,
      text: typeof status === "number" ? String(status) : "ERR",
      label: typeof status === "number" ? `HTTP ${status}` : "Request failed",
    };
  });
  const inspecting = view === "network" && Boolean(requestId);
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

  const { title, description, attachmentType, attachmentUrl, createdAt, reporter } = report.data;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <main className="grid min-h-svh bg-background lg:h-svh lg:grid-cols-[minmax(0,3fr)_minmax(23rem,2fr)]">
      <section className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] lg:min-h-0" aria-label="Report recording">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          {token ? (
            <>
              <Button asChild variant="outline" size="icon" aria-label="Home"><Link to="/"><Home /></Link></Button>
              <Button asChild variant="ghost"><Link to="/"><LayoutGrid />All Zapp</Link></Button>
            </>
          ) : <span className="text-sm font-medium text-muted-foreground">Zapp report</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button className="bg-[#7ed957] font-semibold text-black hover:bg-[#6fc94a]" onClick={() => void copyLink()}>{copyState === "copied" ? <Check /> : <Link2 />}{copyState === "copied" ? "Copied" : "Copy link"}</Button>
          {copyState === "failed" && <span role="status" className="text-sm">Copy the URL from the address bar.</span>}
        </div>
      </header>
      <div className="min-w-0 lg:overflow-y-auto">
            {attachmentType === "screenshot" ? (
              <div className="grid place-items-center bg-neutral-950">
                  {mediaError && <Alert variant="destructive"><AlertDescription>
                    The screenshot could not be loaded.
                    <Button variant="outline" size="sm" disabled={report.isFetching} onClick={() => void report.refetch()}>Reload</Button>
                  </AlertDescription></Alert>}
                  <img className="max-h-[72svh] w-full object-contain" src={attachmentUrl} alt={title ? `Screenshot for ${title}` : "Captured screenshot"} onLoad={() => setMediaError(false)} onError={() => setMediaError(true)} />
              </div>
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
            <article className="grid gap-3 border-t px-4 py-5 sm:px-6">
              <h1 className="break-words text-2xl font-semibold">{title || "Untitled report"}</h1>
              {description && <p className="whitespace-pre-wrap break-words text-muted-foreground">{description}</p>}
              <p className="border-t pt-3 text-xs text-muted-foreground">
                {reporter && <span className="font-medium text-foreground">{reporter} </span>}
                created this report · <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>{timeAgo(createdAt)}</time>
              </p>
            </article>
        </div>
        </section>
        <aside className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] border-t lg:min-h-0 lg:border-l lg:border-t-0" aria-label="Report diagnostics">
          <header className="flex min-h-16 flex-wrap items-center gap-x-3 border-b px-4 py-3">
            <h2 className="font-semibold">DevTools</h2>
            {debuggerStatus && <p className="text-xs text-muted-foreground">{debuggerMessage[debuggerStatus]}</p>}
          </header>
          <div className="min-w-0 lg:overflow-auto">
            <Tabs value={view} onValueChange={(value) => {
              if (value === "timeline" || value === "console" || value === "network") setView(value);
            }}>
              <div className="sticky top-0 z-10 border-b bg-background px-4 pt-3 pb-2">
              <TabsList variant="line" aria-label="Debugger views" className="h-auto">
                {(["console", "network", "timeline"] as const).map((tab) => (
                  <TabsTrigger key={tab} value={tab} className="flex-none rounded-md border-transparent px-3 py-1.5 capitalize data-active:border-[#7ed957]">{tab}</TabsTrigger>
                ))}
              </TabsList>
              </div>
              <TabsContent value={view}>
                {inspecting && (
                  <div className="grid gap-3 p-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelection(undefined)}><ArrowLeft />Back</Button>
                      {networkDetail && <span className="truncate font-mono text-xs" title={requestParts(networkDetail.event).path}>{requestParts(networkDetail.event).method} {requestParts(networkDetail.event).path}</span>}
                    </div>
                    {detail.isPending && <Spinner aria-label="Loading the request" />}
                    {detail.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(detail.error)}</AlertDescription></Alert>}
                    {networkDetail && (
                      <Tabs key={requestId} defaultValue={networkDetail.details?.request != null ? "request" : "all"}>
                        <TabsList variant="line" aria-label="Request detail views" className="h-auto">
                          {([["request", "Request"], ["response", "Response"], ["timing", "Timing"], ["all", "All data"]] as const).filter(([part]) => part === "all" || networkDetail.details?.[part] != null).map(([part, label]) => (
                            <TabsTrigger key={part} value={part} className="flex-none rounded-md border-transparent px-3 py-1.5 data-active:border-[#7ed957]">{label}</TabsTrigger>
                          ))}
                        </TabsList>
                        {(["request", "response", "timing", "all"] as const).map((part) => {
                          const data = part === "all" ? (networkDetail.details ?? networkDetail.event.data) : networkDetail.details?.[part];
                          if (data == null && part !== "all") return null;
                          return <TabsContent key={part} value={part}><pre className="max-h-[60svh] overflow-auto break-all whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs">{JSON.stringify(data, null, 2)}</pre></TabsContent>;
                        })}
                      </Tabs>
                    )}
                  </div>
                )}
                {!inspecting && <>
                <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
                  <div className="relative min-w-32 flex-1">
                    <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
                    <Input className="border-0 bg-muted/50 pl-8" aria-label="Filter loaded events" placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
                  </div>
                  {view === "network" && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />
                      Errors only
                    </label>
                  )}
                </div>
                {view === "network" && (
                  <div className="flex flex-wrap gap-1.5 border-b px-4 py-2" role="group" aria-label="Resource type">
                    {typeChips.map(({ key, label }) => (
                      <Button key={key} size="xs" variant={typeFilter === key ? "default" : "outline"} aria-pressed={typeFilter === key} onClick={() => setTypeFilter(key)}>{label}</Button>
                    ))}
                  </div>
                )}
                {events.isPending &&<div className="p-4"><Spinner aria-label="Loading diagnostic events" /></div>}
                {events.isError && <div className="p-4"><Alert variant="destructive"><AlertDescription>{errorMessage(events.error)}</AlertDescription></Alert></div>}
                {events.isSuccess && rows.length === 0 && (
                  <Empty><EmptyHeader><EmptyTitle>No events in this view</EmptyTitle><EmptyDescription>{view === "console" && events.hasNextPage ? "Load more timeline entries to find console messages." : "Captured events appear here when available."}</EmptyDescription></EmptyHeader></Empty>
                )}
                {rows.length > 0 && view === "network" && (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Name</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead>Domain</TableHead><TableHead>Type</TableHead><TableHead>Time</TableHead><TableHead className="text-right">At</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((event) => {
                        const { method, status, path, host, type, time } = requestParts(event);
                        return (
                          <TableRow key={event.id} className={`cursor-pointer font-mono text-xs ${isNetworkError(event) ? "bg-destructive/10" : ""}`} onClick={() => setSelection({ reportId: id, requestId: event.id })}>
                            <TableCell className="max-w-40 truncate" title={path}>
                              <button type="button" className="max-w-full truncate text-left focus-visible:underline focus-visible:outline-none" aria-label={`Inspect ${method} ${path}`}>{path}</button>
                            </TableCell>
                            <TableCell>{method}</TableCell>
                            <TableCell>{status}</TableCell>
                            <TableCell className="max-w-28 truncate text-muted-foreground" title={host}>{host}</TableCell>
                            <TableCell className="text-muted-foreground">{type}</TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">{time}</TableCell>
                            <TableCell className="text-right">
                              {attachmentType === "video" ? (
                                <Button variant="link" size="sm" onClick={(click) => { click.stopPropagation(); seekVideo(video.current, event.offsetMs / 1000); }}>{clock(event.offsetMs / 1000)}</Button>
                              ) : <span className="text-muted-foreground">{clock(event.offsetMs / 1000)}</span>}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
                {rows.length > 0 && view !== "network" && (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Time</TableHead><TableHead>Event</TableHead>
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {events.hasNextPage && <div className="p-4">
                  <Button variant="outline" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>Load more</Button>
                </div>}
                </>}
              </TabsContent>
            </Tabs>
          </div>
        </aside>
    </main>
  );
}
