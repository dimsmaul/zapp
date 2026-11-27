import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Camera, Play, Plus, Search, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ContextMenu, ContextMenuContent, ContextMenuLabel, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { type ReportSummary, type Visibility, listReports, updateVisibility } from "./api";
import { visibilityOption, visibilityOptions } from "./visibility";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A report card. Right-click it (when you may manage it) to change who can view it. */
function ReportCard({ report, onVisibility }: { report: ReportSummary; onVisibility: (visibility: Visibility) => void }) {
  const card = (
    <Link to="/s/$id" params={{ id: report.id }} className="group grid gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Thumbnail report={report} />
      <div className="grid gap-0.5 px-1">
        <span className="truncate font-medium">{report.title || "Untitled"}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {(() => { const { Icon, label } = visibilityOption(report.visibility); return <Icon size={12} aria-label={label} />; })()}
          {report.createdAt && dateFormat.format(new Date(report.createdAt))}
        </span>
      </div>
    </Link>
  );
  if (!report.canManage) return card;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>Who can view</ContextMenuLabel>
        <ContextMenuRadioGroup value={report.visibility} onValueChange={(value) => onVisibility(value as Visibility)}>
          {visibilityOptions.map(({ value, label, Icon }) => (
            <ContextMenuRadioItem key={value} value={value}><Icon />{label}</ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Card thumbnail: first frame of a recording (or the screenshot) that plays on hover. */
function Thumbnail({ report }: { report: ReportSummary }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const isVideo = report.attachmentType !== "screenshot";
  const media = Boolean(report.previewUrl) && visible && !failed;

  // Only load media for cards that are on (or near) the screen.
  useEffect(() => {
    const node = box.current;
    if (!node || !report.previewUrl) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [report.previewUrl]);

  return (
    <div
      ref={box}
      className="relative grid aspect-video place-items-center overflow-hidden rounded-xl bg-neutral-900 text-white ring-1 ring-foreground/10 transition-shadow group-hover:ring-2 group-hover:ring-ring"
      onPointerEnter={() => void video.current?.play().catch(() => undefined)}
      onPointerLeave={() => {
        const player = video.current;
        if (!player) return;
        player.pause();
        player.currentTime = 0.1;
      }}
    >
      {media && isVideo && (
        <video ref={video} src={`${report.previewUrl}#t=0.1`} preload="metadata" muted loop playsInline className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />
      )}
      {media && !isVideo && (
        <img src={report.previewUrl ?? ""} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />
      )}
      {isVideo
        ? <span className="relative grid size-11 place-items-center rounded-full bg-white/20 backdrop-blur transition-opacity group-hover:opacity-0"><Play className="size-5 fill-current" /></span>
        : !media && <Camera className="size-8 opacity-70" />}
      <Badge variant="secondary" className="absolute top-2 left-2">{isVideo ? "Recording" : "Screenshot"}</Badge>
    </div>
  );
}

export function ReportsPage() {
  const [capture, setCapture] = useState<"choose" | "video" | "screenshot" | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [access, setAccess] = useState("all");
  const token = useSession((state) => state.session?.token ?? "");
  const workspaceId = useSession((state) => state.session?.workspaceId);
  const reports = useInfiniteQuery({
    queryKey: ["reports", token, workspaceId],
    queryFn: ({ pageParam, signal }) => listReports(token, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(token && workspaceId),
    retry: false,
  });
  const queryClient = useQueryClient();
  const changeVisibility = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: Visibility }) => updateVisibility(token, id, visibility),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", token, workspaceId] }),
  });
  const items = reports.data?.pages.flatMap((page) => page.items) ?? [];
  const term = search.trim().toLowerCase();
  const visible = items.filter((report) =>
    (type === "all" || report.attachmentType === type)
    && (access === "all" || report.visibility === access)
    && (!term || (report.title ?? "Untitled").toLowerCase().includes(term)));
  const filtering = Boolean(term) || type !== "all" || access !== "all";

  return (
    <section className="w-full">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b py-3 pl-14 pr-4 sm:pl-16 sm:pr-6">
        <h1 className="text-2xl font-semibold">All Zapp</h1>
        <Button onClick={() => setCapture("choose")}><Plus />New Zapp</Button>
      </header>
      <div className="grid gap-5 p-4 sm:p-6 lg:px-10 lg:py-8">
        {reports.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(reports.error)}</AlertDescription></Alert>}
        {changeVisibility.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(changeVisibility.error)}</AlertDescription></Alert>}
        {reports.isPending && <Spinner aria-label="Loading Zapps" />}
        {reports.isSuccess && items.length === 0 && (
          <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Record a tab</CardTitle><CardDescription>Capture video with console and network activity.</CardDescription></CardHeader>
              <CardContent>
                <div className="grid aspect-video place-items-center rounded-lg bg-accent">
                  <Button size="icon-lg" variant="outline" aria-label="Start a tab recording" onClick={() => setCapture("video")}><Video /></Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Take a screenshot</CardTitle><CardDescription>Save what’s visible in the current tab.</CardDescription></CardHeader>
              <CardContent>
                <div className="grid aspect-video place-items-center rounded-lg bg-muted">
                  <Button size="icon-lg" variant="outline" aria-label="Take a screenshot" onClick={() => setCapture("screenshot")}><Camera /></Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        {items.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 max-w-sm flex-1">
                <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" aria-label="Search Zapps" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger aria-label="Filter by type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="video">Recordings</SelectItem>
                  <SelectItem value="screenshot">Screenshots</SelectItem>
                </SelectContent>
              </Select>
              <Select value={access} onValueChange={setAccess}>
                <SelectTrigger aria-label="Filter by access"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any access</SelectItem>
                  {visibilityOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              {filtering && <Button variant="ghost" onClick={() => { setSearch(""); setType("all"); setAccess("all"); }}>Clear</Button>}
            </div>
            {visible.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No Zapp matches your filters{reports.hasNextPage ? " in the loaded items. Load more to search further." : "."}</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visible.map((report) => (
                  <li key={report.id}>
                    <ReportCard report={report} onVisibility={(visibility) => changeVisibility.mutate({ id: report.id, visibility })} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {reports.hasNextPage && (
          <div>
            <Button variant="outline" disabled={reports.isFetchingNextPage} onClick={() => void reports.fetchNextPage()}>Load more</Button>
          </div>
        )}
      </div>
      <Dialog open={capture !== null} onOpenChange={(open) => { if (!open) setCapture(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{capture === "video" ? "Record a tab" : capture === "screenshot" ? "Take a screenshot" : "New Zapp"}</DialogTitle>
            <DialogDescription>Start from the Zapp extension in Chrome.</DialogDescription>
          </DialogHeader>
          {capture === "choose" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setCapture("video")}><Video />Record tab</Button>
              <Button variant="outline" onClick={() => setCapture("screenshot")}><Camera />Screenshot</Button>
            </div>
          ) : (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Open the website tab you want to capture.</li>
              <li>Open the Zapp extension and select <strong>{capture === "video" ? "Record tab" : "Screenshot"}</strong>.</li>
              <li>Review the capture and select <strong>Save &amp; get link</strong>.</li>
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
