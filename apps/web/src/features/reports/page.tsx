import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Camera, FolderOpen, Play, Plus, Search, SearchX, Trash2, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CardGridSkeleton } from "@/components/skeletons";
import { useSession } from "@/features/auth/session";
import { type Folder, listFolders } from "@/features/folders/api";
import { errorMessage } from "@/lib/api";
import { openExtension } from "@/lib/extension";
import { type ReportSummary, type Visibility, deleteReport, listReports, moveToFolder, updateVisibility } from "./api";
import { visibilityOption, visibilityOptions } from "./visibility";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A report card. Right-click it (when you may manage it) to change who can view it. */
const NO_FOLDER = "none";

function ReportCard({ report, folders, onVisibility, onMove, onDelete }: {
  report: ReportSummary;
  folders: Folder[];
  onVisibility: (visibility: Visibility) => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
}) {
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
        {folders.length > 0 && (
          <>
            <ContextMenuLabel>Folder</ContextMenuLabel>
            <ContextMenuRadioGroup value={report.folderId ?? NO_FOLDER} onValueChange={(value) => onMove(value === NO_FOLDER ? null : value)}>
              <ContextMenuRadioItem value={NO_FOLDER}>No folder</ContextMenuRadioItem>
              {folders.map((folder) => <ContextMenuRadioItem key={folder.id} value={folder.id}>{folder.name}</ContextMenuRadioItem>)}
            </ContextMenuRadioGroup>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}><Trash2 />Delete</ContextMenuItem>
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
  const { folder } = useSearch({ from: "/signed-in/reports" });
  const folders = useQuery({
    queryKey: ["folders", token, workspaceId],
    queryFn: ({ signal }) => listFolders(token, signal),
    enabled: Boolean(token && workspaceId),
    retry: false,
  });
  const folderList = folders.data?.items ?? [];
  const currentFolder = folderList.find((item) => item.id === folder);
  const reports = useInfiniteQuery({
    queryKey: ["reports", token, workspaceId, folder],
    queryFn: ({ pageParam, signal }) => listReports(token, pageParam, signal, folder),
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
  const [deleting, setDeleting] = useState<ReportSummary | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => deleteReport(token, id),
    onSuccess: async () => {
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ["reports", token, workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["folders", token, workspaceId] });
    },
  });
  const move = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) => moveToFolder(token, id, folderId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reports", token, workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["folders", token, workspaceId] });
    },
  });
  const items = reports.data?.pages.flatMap((page) => page.items) ?? [];
  const term = search.trim().toLowerCase();
  const visible = items.filter((report) =>
    (type === "all" || report.attachmentType === type)
    && (access === "all" || report.visibility === access)
    && (!term || (report.title ?? "Untitled").toLowerCase().includes(term)));
  const filtering = Boolean(term) || type !== "all" || access !== "all";
  // Opens the extension; when it is not installed or not connected, show the how-to dialog instead.
  const startNew = () => void openExtension().then((opened) => { if (!opened) setCapture("choose"); });

  return (
    <section className="w-full">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b py-3 pl-14 pr-4 sm:pl-16 sm:pr-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {folder ? (
            <>
              <Link to="/folders" className="text-muted-foreground hover:underline">Folders</Link>
              <span aria-hidden="true" className="text-muted-foreground">/</span>
              {currentFolder?.name ?? "Folder"}
            </>
          ) : "All Zapp"}
        </h1>
        <Button onClick={startNew}><Plus />New Zapp</Button>
      </header>
      <div className="grid gap-5 p-4 sm:p-6 lg:px-10 lg:py-8">
        {reports.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(reports.error)}</AlertDescription></Alert>}
        {changeVisibility.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(changeVisibility.error)}</AlertDescription></Alert>}
        {(move.isError || remove.isError) && <Alert variant="destructive"><AlertDescription>{errorMessage(move.error ?? remove.error)}</AlertDescription></Alert>}
        {reports.isPending && <CardGridSkeleton label="Loading Zapps" />}
        {reports.isSuccess && items.length === 0 && folder && (
          <EmptyState icon={FolderOpen} title="No Zapps in this folder yet" description="Right-click a Zapp on All Zapp and choose this folder to move it here.">
            <Button variant="outline" asChild><Link to="/reports">Go to All Zapp</Link></Button>
          </EmptyState>
        )}
        {reports.isSuccess && items.length === 0 && !folder && (
          <EmptyState icon={Video} title="No Zapps yet" description="Record a tab or take a screenshot with the Zapp extension. It shows up here with its console and network activity.">
            <Button onClick={startNew}><Plus />New Zapp</Button>
          </EmptyState>
        )}
        {items.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 max-w-sm flex-1">
                <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" aria-label="Search Zapps" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger aria-label="Filter by type" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="video">Recordings</SelectItem>
                  <SelectItem value="screenshot">Screenshots</SelectItem>
                </SelectContent>
              </Select>
              <Select value={access} onValueChange={setAccess}>
                <SelectTrigger aria-label="Filter by access" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any access</SelectItem>
                  {visibilityOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              {filtering && <Button variant="ghost" onClick={() => { setSearch(""); setType("all"); setAccess("all"); }}>Clear</Button>}
            </div>
            {visible.length === 0 ? (
              <EmptyState icon={SearchX} title="No Zapp matches your filters" description={reports.hasNextPage ? "Only the loaded Zapps were searched. Load more to search further." : "Try a different search or clear the filters."}>
                <Button variant="outline" onClick={() => { setSearch(""); setType("all"); setAccess("all"); }}>Clear filters</Button>
              </EmptyState>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visible.map((report) => (
                  <li key={report.id}>
                    <ReportCard
                      report={report} folders={folderList}
                      onVisibility={(visibility) => changeVisibility.mutate({ id: report.id, visibility })}
                      onMove={(folderId) => move.mutate({ id: report.id, folderId })}
                      onDelete={() => setDeleting(report)}
                    />
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
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.title || "Untitled"}”?</DialogTitle>
            <DialogDescription>The recording, its console and network logs, and its comments are deleted for everyone. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
