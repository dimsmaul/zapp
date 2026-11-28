import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/auth/session";
import { listFolders } from "@/features/folders/api";
import { errorMessage } from "@/lib/api";
import { createRecordingLink, listRecordingLinks, revokeRecordingLink } from "./api";

const NO_FOLDER = "none";

export function RecordingLinksPage() {
  const session = useSession((state) => state.session);
  const token = session?.token ?? "";
  const workspaceId = session?.workspaceId;
  const enabled = Boolean(token && workspaceId);
  const queryClient = useQueryClient();
  const queryKey = ["recording-links", token, workspaceId] as const;
  const links = useQuery({ queryKey, queryFn: ({ signal }) => listRecordingLinks(token, signal), enabled, retry: false });
  const folders = useQuery({ queryKey: ["folders", token, workspaceId], queryFn: ({ signal }) => listFolders(token, signal), enabled, retry: false });
  const [creating, setCreating] = useState(false);
  const [folder, setFolder] = useState(NO_FOLDER);
  const create = useMutation({
    mutationFn: (input: { name?: string; folderId?: string }) => createRecordingLink(token, input),
    onSuccess: async () => { setCreating(false); setFolder(NO_FOLDER); await queryClient.invalidateQueries({ queryKey }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeRecordingLink(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const items = links.data?.items ?? [];
  const error = links.error ?? revoke.error;
  const openCreate = () => { create.reset(); setCreating(true); };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    create.mutate({ ...(name ? { name } : {}), ...(folder === NO_FOLDER ? {} : { folderId: folder }) });
  }

  return (
    <section className="w-full">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b py-3 pl-14 pr-4 sm:pl-16 sm:pr-6">
        <h1 className="text-2xl font-semibold">Recording links</h1>
        <Button onClick={openCreate}><Plus />New link</Button>
      </header>
      <div className="grid gap-5 p-4 sm:p-6 lg:px-10 lg:py-8">
        {error && <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert>}
        {links.isPending && (
          <Loading label="Loading recording links" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}
          </Loading>
        )}
        {links.isSuccess && items.length === 0 && (
          <EmptyState icon={Link2} title="No recording links yet" description="Send a link to a teammate. It opens their Zapp extension for this workspace, and what they record lands in the folder you pick.">
            <Button onClick={openCreate}><Plus />New link</Button>
          </EmptyState>
        )}
        {items.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((link) => (
              <li key={link.id} className="grid gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <div className="flex items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted"><Link2 className="size-5" aria-hidden="true" /></span>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium">{link.name || (link.folderName ? `Record into ${link.folderName}` : "Record a Zapp")}</span>
                    <span className="truncate text-xs text-muted-foreground">{link.folderName ? `Folder: ${link.folderName}` : "No folder"}</span>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label="Revoke link" disabled={revoke.isPending} onClick={() => revoke.mutate(link.id)}><Trash2 /></Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{link.url}</span>
                  <CopyButton text={link.url} label={`Copy link ${link.name ?? ""}`} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New recording link</DialogTitle>
            <DialogDescription>
              A teammate signed in to Zapp opens the link and it opens their extension for this workspace. The link does not give anyone access.
            </DialogDescription>
          </DialogHeader>
          {create.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(create.error)}</AlertDescription></Alert>}
          <form className="grid gap-4" onSubmit={submit}>
            <Field orientation="vertical">
              <FieldLabel htmlFor="link-name">Name (optional)</FieldLabel>
              <Input id="link-name" name="name" maxLength={80} placeholder="Customer bug reports" autoFocus />
            </Field>
            <Field orientation="vertical">
              <FieldLabel htmlFor="link-folder">Folder</FieldLabel>
              <Select value={folder} onValueChange={setFolder}>
                <SelectTrigger id="link-folder" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={NO_FOLDER}>No folder</SelectItem>
                  {folders.data?.items.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" disabled={create.isPending}>Create link</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
