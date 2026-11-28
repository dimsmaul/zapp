import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Folder as FolderIcon, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { createFolder, deleteFolder, type Folder, listFolders, renameFolder } from "./api";

type Editing = { id: string | null; name: string };

export function FoldersPage() {
  const session = useSession((state) => state.session);
  const token = session?.token ?? "";
  const workspaceId = session?.workspaceId;
  const queryClient = useQueryClient();
  const queryKey = ["folders", token, workspaceId] as const;
  const folders = useQuery({ queryKey, queryFn: ({ signal }) => listFolders(token, signal), enabled: Boolean(token && workspaceId), retry: false });
  // One dialog both creates (id null) and renames a folder.
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<Folder | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const save = useMutation({
    mutationFn: ({ id, name }: Editing) => (id ? renameFolder(token, id, name) : createFolder(token, name)),
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
  const items = folders.data?.items ?? [];
  const error = folders.error ?? remove.error;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing?.name.trim()) save.mutate({ ...editing, name: editing.name.trim() });
  }

  return (
    <section className="w-full">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b py-3 pl-14 pr-4 sm:pl-16 sm:pr-6">
        <h1 className="text-2xl font-semibold">Folders</h1>
        <Button onClick={() => { save.reset(); setEditing({ id: null, name: "" }); }}><Plus />New folder</Button>
      </header>
      <div className="grid gap-5 p-4 sm:p-6 lg:px-10 lg:py-8">
        {error && <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert>}
        {folders.isPending && (
          <Loading label="Loading folders" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)}
          </Loading>
        )}
        {folders.isSuccess && items.length === 0 && (
          <EmptyState icon={FolderIcon} title="No folders yet" description="Group Zapps by project, team, or customer. A Zapp can be in one folder.">
            <Button onClick={() => { save.reset(); setEditing({ id: null, name: "" }); }}><Plus />New folder</Button>
          </EmptyState>
        )}
        {items.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((folder) => (
              <li key={folder.id} className="group relative flex items-center gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow hover:ring-2 hover:ring-ring">
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted"><FolderIcon className="size-5" aria-hidden="true" /></span>
                <Link to="/reports" search={{ folder: folder.id }} className="grid min-w-0 flex-1 gap-0.5 outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
                  <span className="truncate font-medium">{folder.name}</span>
                  <span className="text-xs text-muted-foreground">{folder.reportCount} {folder.reportCount === 1 ? "Zapp" : "Zapps"}</span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="relative z-10" aria-label={`Actions for ${folder.name}`}><MoreHorizontal /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => { save.reset(); setEditing({ id: folder.id, name: folder.name }); }}><Pencil />Rename</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRemoving(folder)}><Trash2 />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{editing?.id ? "Rename folder" : "New folder"}</DialogTitle>
              <DialogDescription>{editing?.id ? "Zapps in the folder keep their place." : "Group Zapps by project, team, or customer."}</DialogDescription>
            </DialogHeader>
            {save.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(save.error)}</AlertDescription></Alert>}
            <Input aria-label="Folder name" placeholder="Folder name" value={editing?.name ?? ""} maxLength={80} required autoFocus onChange={(event) => setEditing(editing && { ...editing, name: event.target.value })} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{editing?.id ? "Save" : "Create folder"}</Button>
            </DialogFooter>
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
