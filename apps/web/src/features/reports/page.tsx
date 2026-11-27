import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { listReports } from "./api";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ReportsPage() {
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
    <main className="mx-auto grid max-w-5xl gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <Button asChild variant="outline"><Link to="/workspaces">Workspaces</Link></Button>
      </header>
      {reports.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(reports.error)}</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>Workspace reports</CardTitle></CardHeader>
        <CardContent>
          {reports.isPending && <Spinner aria-label="Loading reports" />}
          {reports.isSuccess && items.length === 0 && (
            <Empty><EmptyHeader><EmptyTitle>No reports yet</EmptyTitle><EmptyDescription>Capture a screenshot or recording with the Zapp extension.</EmptyDescription></EmptyHeader></Empty>
          )}
          {items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Access</TableHead><TableHead>Created</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {items.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell><Button asChild variant="link"><Link to="/s/$id" params={{ id: report.id }}>{report.title || "Untitled report"}</Link></Button></TableCell>
                    <TableCell>{report.attachmentType === "screenshot" ? "Screenshot" : "Recording"}</TableCell>
                    <TableCell><Badge variant="secondary">{report.visibility}</Badge></TableCell>
                    <TableCell>{report.createdAt && dateFormat.format(new Date(report.createdAt))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {reports.hasNextPage && (
            <div className="mt-4">
              <Button variant="outline" disabled={reports.isFetchingNextPage} onClick={() => void reports.fetchNextPage()}>Load more</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
