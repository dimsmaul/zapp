import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { logout } from "@/features/auth/api";
import { useSession } from "@/features/auth/session";
import { ApiError, errorMessage } from "@/lib/api";
import { createWorkspace, listWorkspaces, selectWorkspace } from "./api";

export function WorkspacesPage() {
  const session = useSession((state) => state.session);
  const setSession = useSession((state) => state.setSession);
  const setWorkspace = useSession((state) => state.selectWorkspace);
  const token = session?.token ?? "";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const queryKey = ["workspaces", token] as const;
  const workspaces = useQuery({
    queryKey,
    queryFn: ({ signal }) => listWorkspaces(token, signal),
    enabled: Boolean(token),
    retry: false,
  });
  const signOut = useMutation({
    mutationFn: () => logout(token),
    onSettled: async () => {
      queryClient.clear();
      setSession(null);
      await navigate({ to: "/login", replace: true });
    },
  });
  const select = useMutation({
    mutationFn: (id: string) => selectWorkspace(token, id),
    onSuccess: async (result) => {
      setWorkspace(result.workspaceId);
      await navigate({ to: "/reports" });
    },
  });
  const create = useMutation({
    mutationFn: (name: string) => createWorkspace(token, name),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey });
      select.mutate(workspace.id);
    },
  });
  const error = select.error ?? create.error ?? workspaces.error;
  const pending = create.isPending || select.isPending || signOut.isPending;
  const signInAgain = error instanceof ApiError && error.status === 401;

  function addWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    if (name) create.mutate(name);
  }

  return (
    <main className="mx-auto grid max-w-3xl gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <div className="flex flex-wrap items-center gap-2">
          {session?.workspaceId && <Button asChild variant="outline"><Link to="/reports">Reports</Link></Button>}
          <Button variant="ghost" disabled={pending} onClick={() => signOut.mutate()}>Sign out</Button>
        </div>
      </header>
      {error && <Alert variant="destructive"><AlertDescription>{signInAgain ? "Your session has expired. Sign in again." : errorMessage(error)}</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>Your workspaces</CardTitle><CardDescription>Choose a workspace to view its reports.</CardDescription></CardHeader>
        <CardContent>
          {workspaces.isPending && <Spinner aria-label="Loading workspaces" />}
          {workspaces.data?.items.length === 0 && <p>You haven’t joined a workspace yet.</p>}
          <ul className="grid gap-3">
            {workspaces.data?.items.map((workspace) => (
              <li key={workspace.id} className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{workspace.name}</span>
                  <Badge variant="secondary">{workspace.role}</Badge>
                </div>
                <Button variant="outline" disabled={pending} onClick={() => select.mutate(workspace.id)}>
                  {workspace.id === session?.workspaceId ? "Open" : "Select"}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Create a workspace</CardTitle></CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={addWorkspace}>
            <Field orientation="vertical">
              <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
              <Input id="workspace-name" name="name" maxLength={50} required />
            </Field>
            <Button type="submit" disabled={pending || signInAgain}>Create workspace</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
