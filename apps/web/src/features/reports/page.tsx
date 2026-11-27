import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Camera, Plus, Video } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { listReports } from "./api";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ReportsPage() {
  const [capture, setCapture] = useState<"choose" | "video" | "screenshot" | null>(null);
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

  return (
    <section className="w-full">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b py-3 pl-14 pr-4 sm:pl-16 sm:pr-6">
        <h1 className="text-2xl font-semibold">All reports</h1>
        <Button onClick={() => setCapture("choose")}><Plus />New capture</Button>
      </header>
      <div className="grid gap-5 p-4 sm:p-6 lg:px-10 lg:py-8">
          {reports.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(reports.error)}</AlertDescription></Alert>}
          {reports.isPending && <Spinner aria-label="Loading reports" />}
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
            <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Access</TableHead><TableHead>Created</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {items.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell><Button asChild variant="link"><Link to="/s/$id" params={{ id: report.id }}>{report.title || "Untitled report"}</Link></Button></TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        {report.attachmentType === "screenshot" ? <><Camera size={16} /> Screenshot</> : <><Video size={16} /> Recording</>}
                      </span>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{report.visibility}</Badge></TableCell>
                    <TableCell>{report.createdAt && dateFormat.format(new Date(report.createdAt))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
          {reports.hasNextPage && (
            <div className="mt-4">
              <Button variant="outline" disabled={reports.isFetchingNextPage} onClick={() => void reports.fetchNextPage()}>Load more</Button>
            </div>
          )}
      </div>
      <Dialog open={capture !== null} onOpenChange={(open) => { if (!open) setCapture(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{capture === "video" ? "Record a tab" : capture === "screenshot" ? "Take a screenshot" : "New capture"}</DialogTitle>
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
