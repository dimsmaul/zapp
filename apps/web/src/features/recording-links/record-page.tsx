import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Video } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/features/auth/session";
import { selectWorkspace } from "@/features/workspaces/api";
import { ApiError, errorMessage } from "@/lib/api";
import { openExtension } from "@/lib/extension";
import { lookupRecordingLink } from "./api";

/** The page a recording link opens: it points the extension at a workspace and folder. */
export function RecordPage() {
  const { token: linkToken } = useParams({ from: "/r/$token" });
  const session = useSession((state) => state.session);
  const setWorkspace = useSession((state) => state.selectWorkspace);
  const token = session?.token ?? "";
  const [missing, setMissing] = useState(false);
  const target = useQuery({
    queryKey: ["recording-link", linkToken, token],
    queryFn: ({ signal }) => lookupRecordingLink(token, linkToken, signal),
    enabled: Boolean(token),
    retry: false,
  });
  const info = target.data;

  // Recording into the link's workspace means working in it, so switch the website to it too.
  const switchWorkspace = useMutation({ mutationFn: (id: string) => selectWorkspace(token, id), onSuccess: (result) => setWorkspace(result.workspaceId) });
  useEffect(() => {
    if (info?.member && session?.workspaceId !== info.workspaceId && switchWorkspace.isIdle) switchWorkspace.mutate(info.workspaceId);
  }, [info, session?.workspaceId, switchWorkspace]);

  const start = useMutation({
    mutationFn: async () => {
      if (!info) return;
      setMissing(!await openExtension({ workspaceId: info.workspaceId, folderId: info.folderId, folderName: info.folderName }));
    },
  });
  const notFound = target.error instanceof ApiError && target.error.status === 404;
  const error = target.error && !notFound ? target.error : switchWorkspace.error;

  return (
    <main className="grid min-h-svh place-items-center bg-sidebar p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground"><Video className="size-5" /></span>
          <CardTitle>{notFound ? "This link is no longer valid" : info ? `Record a Zapp for ${info.workspaceName ?? "your workspace"}` : "Opening recording link"}</CardTitle>
          {info && (
            <CardDescription>
              {info.member
                ? info.folderName ? `It will be saved in the “${info.folderName}” folder.` : "It will be saved in the workspace."
                : "You are not a member of this workspace. Ask an admin to invite you, then open the link again."}
            </CardDescription>
          )}
          {notFound && <CardDescription>It may have been revoked. Ask the person who sent it for a new one.</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-3">
          {error && <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert>}
          {missing && (
            <Alert>
              <AlertDescription>
                The Zapp extension did not respond. Install it, connect it to this server, reload this page, and try again.
                You can also open the extension yourself and pick a workspace.
              </AlertDescription>
            </Alert>
          )}
          {info?.member && <Button disabled={start.isPending || switchWorkspace.isPending} onClick={() => start.mutate()}>Open the extension</Button>}
        </CardContent>
        <CardFooter>
          <Button variant="ghost" asChild><Link to="/reports">Go to Zapp</Link></Button>
        </CardFooter>
      </Card>
    </main>
  );
}
