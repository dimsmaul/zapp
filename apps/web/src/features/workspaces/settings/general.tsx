import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/features/auth/session";
import { visibilityOption, visibilityOptions } from "@/features/reports/visibility";
import { errorMessage } from "@/lib/api";
import { type Workspace, deleteWorkspace, leaveWorkspace, updateWorkspace } from "../api";

type Props = { token: string; workspace: Workspace };

export function GeneralSection({ token, workspace }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useSession((state) => state.session);
  const setSession = useSession((state) => state.setSession);
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const isOwner = workspace.role === "owner";
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const defaultVisibility = visibilityOption(workspace.defaultVisibility ?? "private");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["workspaces", token] });
  const save = useMutation({
    mutationFn: (changes: { name?: string; defaultVisibility?: "restricted" | "private" | "public" }) =>
      updateWorkspace(token, workspace.id, changes),
    onSuccess: refresh,
  });
  // After leaving or deleting, this workspace can no longer be the active one.
  const goBack = async () => {
    if (session) setSession({ ...session, workspaceId: null });
    await refresh();
    await navigate({ to: "/workspaces" });
  };
  const leave = useMutation({ mutationFn: () => leaveWorkspace(token, workspace.id), onSuccess: goBack });
  const destroy = useMutation({ mutationFn: () => deleteWorkspace(token, workspace.id), onSuccess: goBack });

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (name && name !== workspace.name) save.mutate({ name });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader><CardTitle>Workspace name</CardTitle><CardDescription>Shown in the workspace switcher and in invitations.</CardDescription></CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={rename}>
            <Field orientation="vertical" className="min-w-56 flex-1">
              <FieldLabel htmlFor="workspace-name">Name</FieldLabel>
              <Input id="workspace-name" name="name" key={workspace.name} defaultValue={workspace.name} maxLength={200} required readOnly={!isAdmin} />
            </Field>
            {isAdmin && <Button type="submit" disabled={save.isPending}>Save</Button>}
          </form>
          {save.isError && <Alert variant="destructive" className="mt-3"><AlertDescription>{errorMessage(save.error)}</AlertDescription></Alert>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default visibility</CardTitle>
          <CardDescription>Who can open a new Zapp by default. People can still change it on each Zapp.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Select
            value={workspace.defaultVisibility ?? "private"} disabled={!isAdmin || save.isPending}
            onValueChange={(value) => save.mutate({ defaultVisibility: value as "restricted" | "private" | "public" })}
          >
            <SelectTrigger aria-label="Default visibility" className="w-64">
              <SelectValue><span className="flex items-center gap-2"><defaultVisibility.Icon className="size-4" />{defaultVisibility.label}</span></SelectValue>
            </SelectTrigger>
            <SelectContent position="popper">
              {visibilityOptions.map(({ value, label, Icon }) => <SelectItem key={value} value={value}><Icon className="size-4" />{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{defaultVisibility.hint}.</p>
        </CardContent>
      </Card>

      {!isOwner && (
        <Card>
          <CardHeader><CardTitle>Leave workspace</CardTitle><CardDescription>You lose access to this workspace's Zapps until someone invites you again.</CardDescription></CardHeader>
          <CardContent><Button variant="outline" onClick={() => { leave.reset(); setLeaving(true); }}>Leave workspace</Button></CardContent>
        </Card>
      )}

      {isOwner && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Delete workspace</CardTitle>
            <CardDescription>Removes the workspace, its members, invitations, and capture keys. Delete all of its Zapps first. This cannot be undone.</CardDescription>
          </CardHeader>
          <CardContent><Button variant="destructive" onClick={() => { destroy.reset(); setConfirmName(""); setDeleting(true); }}>Delete workspace</Button></CardContent>
        </Card>
      )}

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent>
          <DialogHeader><DialogTitle>Leave “{workspace.name}”?</DialogTitle><DialogDescription>You will need a new invitation to join again.</DialogDescription></DialogHeader>
          {leave.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(leave.error)}</AlertDescription></Alert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaving(false)}>Cancel</Button>
            <Button variant="destructive" disabled={leave.isPending} onClick={() => leave.mutate()}>Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{workspace.name}”?</DialogTitle>
            <DialogDescription>Type the workspace name to confirm. This permanently removes the workspace and everything that belongs to it.</DialogDescription>
          </DialogHeader>
          {destroy.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(destroy.error)}</AlertDescription></Alert>}
          <Input aria-label="Workspace name" placeholder={workspace.name} value={confirmName} onChange={(event) => setConfirmName(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="destructive" disabled={destroy.isPending || confirmName !== workspace.name} onClick={() => destroy.mutate()}>Delete workspace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
