import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { type Invitation, type PendingInvitation, type Workspace, inviteMember, listInvitations, revokeInvitation } from "../api";

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type Props = { token: string; workspace: Workspace };

export function InvitationsSection({ token, workspace }: Props) {
  const queryClient = useQueryClient();
  const [fresh, setFresh] = useState<Invitation>();

  const key = ["workspace-invitations", token, workspace.id] as const;
  const pending = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listInvitations(token, workspace.id, signal),
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const invite = useMutation({
    mutationFn: (email: string) => inviteMember(token, workspace.id, email),
    onSuccess: async (result) => { setFresh(result); await refresh(); },
  });
  const revoke = useMutation({
    mutationFn: (item: PendingInvitation) => revokeInvitation(token, workspace.id, item.id),
    onSuccess: refresh,
  });
  // An invite link is shown only once, so a lost one is replaced: revoke it and create a new one.
  const renew = useMutation({
    mutationFn: async (item: PendingInvitation) => {
      await revokeInvitation(token, workspace.id, item.id);
      return inviteMember(token, workspace.id, item.email);
    },
    onSuccess: async (result) => { setFresh(result); await refresh(); },
  });

  const inviteLink = fresh ? `${window.location.origin}/invite/${fresh.token}` : "";
  const error = invite.error ?? revoke.error ?? renew.error ?? pending.error;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email")).trim();
    if (email) invite.mutate(email, { onSuccess: () => form.reset() });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>Zapp creates a link that works for seven days, only for the invited email. Send it to them yourself.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
            <Field orientation="vertical" className="min-w-56 flex-1">
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input id="invite-email" name="email" type="email" required placeholder="teammate@example.com" />
            </Field>
            <Button type="submit" disabled={invite.isPending}><UserPlus />Create invite</Button>
          </form>
          {error != null && <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert>}
          {fresh && (
            <div className="grid gap-2 rounded-lg border p-3">
              <p className="text-sm">Invite for <strong>{fresh.email}</strong>. This link is shown once.</p>
              <div className="flex gap-2">
                <Input readOnly aria-label="Invite link" value={inviteLink} onFocus={(event) => event.currentTarget.select()} />
                <CopyButton text={inviteLink} label="Copy invite link" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>People who were invited and have not joined yet. Expired invitations disappear.</CardDescription>
        </CardHeader>
        <CardContent>
          {pending.isPending && <Spinner aria-label="Loading invitations" />}
          {pending.isSuccess && pending.data.items.length === 0 && <p className="text-sm text-muted-foreground">No pending invitations.</p>}
          <ul className="grid divide-y">
            {pending.data?.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="grid min-w-0">
                  <span className="truncate text-sm">{item.email}</span>
                  <span className="text-xs text-muted-foreground">Expires {date.format(new Date(item.expiresAt))}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="sm" disabled={renew.isPending} onClick={() => renew.mutate(item)}><RefreshCw />New link</Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Revoke invitation for ${item.email}`} disabled={revoke.isPending} onClick={() => revoke.mutate(item)}><Trash2 /></Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
