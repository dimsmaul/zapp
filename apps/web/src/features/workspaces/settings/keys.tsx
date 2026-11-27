import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { type CaptureKey, type CreatedKey, type Workspace, createKey, listKeys, revokeKey, updateKey } from "../api";

type Props = { token: string; workspace: Workspace };

const textarea = "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const parseOrigins = (value: string) => value.split(/[\s,]+/).map((origin) => origin.trim()).filter(Boolean);

export function KeysSection({ token, workspace }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CaptureKey | "new">();
  const [revoking, setRevoking] = useState<CaptureKey>();
  const [created, setCreated] = useState<CreatedKey>();

  const key = ["capture-keys", token, workspace.id] as const;
  const keys = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listKeys(token, workspace.id, signal),
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: ({ target, origins }: { target: CaptureKey | "new"; origins: string[] }) =>
      target === "new" ? createKey(token, workspace.id, origins) : updateKey(token, workspace.id, target.id, origins),
    onSuccess: async (result, { target }) => {
      if (target === "new") setCreated(result as CreatedKey);
      setEditing(undefined);
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (item: CaptureKey) => revokeKey(token, workspace.id, item.id),
    onSuccess: async () => { setRevoking(undefined); await refresh(); },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    save.mutate({ target: editing, origins: parseOrigins(String(new FormData(event.currentTarget).get("origins"))) });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle>Capture keys</CardTitle>
            <CardDescription>A capture key lets the Zapp widget on your own website send captures to this workspace. Each key works only on the origins you allow.</CardDescription>
          </div>
          <Button onClick={() => { save.reset(); setEditing("new"); }}><Plus />New key</Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {created && (
            <Alert>
              <KeyRound />
              <AlertDescription className="grid gap-2">
                <span>Key created. Copy it now, because it is shown only once.</span>
                <div className="flex gap-2">
                  <Input readOnly aria-label="New capture key" value={created.key} onFocus={(event) => event.currentTarget.select()} />
                  <CopyButton text={created.key} label="Copy capture key" />
                </div>
              </AlertDescription>
            </Alert>
          )}
          {keys.isPending && <Spinner aria-label="Loading keys" />}
          {keys.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(keys.error)}</AlertDescription></Alert>}
          {keys.isSuccess && keys.data.items.length === 0 && <p className="text-sm text-muted-foreground">No capture keys yet.</p>}
          <ul className="grid divide-y">
            {keys.data?.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                <div className="grid min-w-0 gap-1.5">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <code className="font-mono text-xs">{item.id.slice(0, 8)}…</code>
                    <Badge variant={item.status === "active" ? "secondary" : "destructive"} className="capitalize">{item.status}</Badge>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {item.allowedOrigins.map((origin) => <Badge key={origin} variant="outline" className="font-mono text-[11px]">{origin}</Badge>)}
                  </span>
                </div>
                {item.status === "active" && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label="Edit allowed origins" onClick={() => { save.reset(); setEditing(item); }}><Pencil /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Revoke key" onClick={() => { revoke.reset(); setRevoking(item); }}><Trash2 /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={editing !== undefined} onOpenChange={(open) => { if (!open) setEditing(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New capture key" : "Allowed origins"}</DialogTitle>
            <DialogDescription>List the websites that may use this key, one per line, for example https://app.example.com.</DialogDescription>
          </DialogHeader>
          {save.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(save.error)}</AlertDescription></Alert>}
          <form className="grid gap-4" onSubmit={submit}>
            <Field orientation="vertical">
              <FieldLabel htmlFor="key-origins">Origins</FieldLabel>
              <textarea
                id="key-origins" name="origins" required className={textarea} placeholder="https://app.example.com"
                key={editing === "new" ? "new" : editing?.id}
                defaultValue={editing && editing !== "new" ? editing.allowedOrigins.join("\n") : ""}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{editing === "new" ? "Create key" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== undefined} onOpenChange={(open) => { if (!open) setRevoking(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this key?</DialogTitle>
            <DialogDescription>Widgets that use it stop being able to send captures immediately. This cannot be undone.</DialogDescription>
          </DialogHeader>
          {revoke.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(revoke.error)}</AlertDescription></Alert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(undefined)}>Cancel</Button>
            <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking)}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
