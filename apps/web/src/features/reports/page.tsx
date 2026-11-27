import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Camera, Globe, Lock, Play, Plus, Search, Video } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { listReports } from "./api";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

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
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
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
                    <Link to="/s/$id" params={{ id: report.id }} className="group grid gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl bg-neutral-900 text-white ring-1 ring-foreground/10 transition-shadow group-hover:ring-2 group-hover:ring-ring">
                        {report.attachmentType === "screenshot" ? <Camera className="size-8 opacity-70" /> : <span className="grid size-11 place-items-center rounded-full bg-white/20 backdrop-blur"><Play className="size-5 fill-current" /></span>}
                        <Badge variant="secondary" className="absolute top-2 left-2">{report.attachmentType === "screenshot" ? "Screenshot" : "Recording"}</Badge>
                      </div>
                      <div className="grid gap-0.5 px-1">
                        <span className="truncate font-medium">{report.title || "Untitled"}</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {report.visibility === "public" ? <Globe size={12} aria-label="Public" /> : <Lock size={12} aria-label="Private" />}
                          {report.createdAt && dateFormat.format(new Date(report.createdAt))}
                        </span>
                      </div>
                    </Link>
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
