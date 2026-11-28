import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Folder as FolderIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ListSkeleton } from "@/components/skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { createFolder, deleteFolder, type Folder, listFolders, renameFolder } from "./api";

export function FoldersPage() {
  const session = useSession((state) => state.session);
  const token = session?.token ?? "";
  const workspaceId = session?.workspaceId;
  const queryClient = useQueryClient();
  const queryKey = ["folders", token, workspaceId] as const;
  const folders = useQuery({ queryKey, queryFn: ({ signal }) => listFolders(token, signal), enabled: Boolean(token && workspaceId), retry: false });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Folder | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const create = useMutation({ mutationFn: (name: string) => createFolder(token, name), onSuccess: refresh });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameFolder(token, id, name),
    onSuccess: async () => { setEditing(null); await refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFolder(token, id),
    onSuccess: async () => {
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
      await refresh();
    },
  });
  const error = folders.error ?? create.error ?? rename.error ?? remove.error;

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name")).trim();
    if (name) create.mutate(name, { onSuccess: () => form.reset() });
  }

  return (
    <section className="w-full">
      <header className="flex min-h-16 items-center border-b pl-14 pr-4 sm:pl-16 sm:pr-6">
        <h1 className="text-2xl font-semibold">Folders</h1>
      </header>
      <div className="grid w-full max-w-5xl gap-6 p-4 sm:p-6 lg:p-8">
        {error && <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert>}
        <Card>
          <CardHeader>
            <CardTitle>New folder</CardTitle>
            <CardDescription>Group Zapps by project, team, or customer. A Zapp can be in one folder.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="flex flex-wrap gap-2">
              <Input name="name" aria-label="Folder name" placeholder="Folder name" maxLength={80} required className="max-w-sm flex-1" />
              <Button type="submit" disabled={create.isPending}><Plus />Create folder</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Your folders</CardTitle></CardHeader>
          <CardContent>
            {folders.isPending && <ListSkeleton label="Loading folders" rows={3} avatar={false} />}
            {folders.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No folders yet. Create one above.</p>}
            <ul className="grid divide-y">
              {folders.data?.items.map((folder) => (
                <li key={folder.id} className="flex items-center gap-3 py-2.5">
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <Link to="/reports" search={{ folder: folder.id }} className="min-w-0 flex-1 truncate font-medium hover:underline">{folder.name}</Link>
                  <Badge variant="secondary">{folder.reportCount} {folder.reportCount === 1 ? "Zapp" : "Zapps"}</Badge>
                  <Button variant="ghost" size="icon-sm" aria-label={`Rename ${folder.name}`} onClick={() => setEditing({ id: folder.id, name: folder.name })}><Pencil /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${folder.name}`} onClick={() => setRemoving(folder)}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <form onSubmit={(event) => { event.preventDefault(); if (editing?.name.trim()) rename.mutate({ id: editing.id, name: editing.name.trim() }); }} className="grid gap-4">
            <DialogHeader><DialogTitle>Rename folder</DialogTitle><DialogDescription>Zapps in the folder keep their place.</DialogDescription></DialogHeader>
            <Input aria-label="Folder name" value={editing?.name ?? ""} maxLength={80} required onChange={(event) => setEditing(editing && { ...editing, name: event.target.value })} />
            <DialogFooter><Button type="submit" disabled={rename.isPending}>Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{removing?.name}”?</DialogTitle>
            <DialogDescription>The Zapps inside are kept. They just stop being in a folder.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>Delete folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
