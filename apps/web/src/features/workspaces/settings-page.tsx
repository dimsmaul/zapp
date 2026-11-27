import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Trash2, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { type Invitation, type Member, inviteMember, listMembers, listWorkspaces, removeMember } from "./api";

export function WorkspaceSettingsPage() {
  const session = useSession((state) => state.session);
  const token = session?.token ?? "";
  const workspaceId = session?.workspaceId ?? "";
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<Member>();
  const [invitation, setInvitation] = useState<Invitation>();
  const [copied, setCopied] = useState(false);

  const workspaces = useQuery({
    queryKey: ["workspaces", token],
    queryFn: ({ signal }) => listWorkspaces(token, signal),
    enabled: Boolean(token),
    staleTime: 30_000,
  });
  const workspace = workspaces.data?.items.find((item) => item.id === workspaceId);
  const role = workspace?.role;
  const isAdmin = role === "owner" || role === "admin";

  const membersKey = ["workspace-members", token, workspaceId] as const;
  const members = useQuery({
    queryKey: membersKey,
    queryFn: ({ signal }) => listMembers(token, workspaceId, signal),
    enabled: Boolean(token && workspaceId),
    retry: false,
  });
  const invite = useMutation({
    mutationFn: (email: string) => inviteMember(token, workspaceId, email),
    onSuccess: (result) => { setInvitation(result); setCopied(false); },
  });
  const remove = useMutation({
    mutationFn: (member: Member) => removeMember(token, workspaceId, member.userId),
    onSuccess: async () => {
      setRemoving(undefined);
      await queryClient.invalidateQueries({ queryKey: membersKey });
    },
  });

  // Mirrors the server: owners remove anyone but an owner; admins remove regular members only.
  const canRemove = (member: Member) =>
    member.role !== "owner" && (role === "owner" || (role === "admin" && member.role === "member"));
  const inviteLink = invitation ? `${window.location.origin}/invite/${invitation.token}` : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email")).trim();
    if (!email) return;
    invite.mutate(email, { onSuccess: () => form.reset() });
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="w-full">
      <header className="flex min-h-16 items-center border-b pl-14 pr-4 sm:pl-16 sm:pr-6">
        <h1 className="text-2xl font-semibold">Workspace settings</h1>
      </header>
      <div className="grid w-full max-w-3xl gap-6 p-4 sm:p-6 lg:p-8">
        {workspace && <p className="text-sm text-muted-foreground">{workspace.name}</p>}

        {isAdmin && (
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
              {invite.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(invite.error)}</AlertDescription></Alert>}
              {invitation && (
                <div className="grid gap-2 rounded-lg border p-3">
                  <p className="text-sm">Invite for <strong>{invitation.email}</strong>. This link is shown once.</p>
                  <div className="flex gap-2">
                    <Input readOnly aria-label="Invite link" value={inviteLink} onFocus={(event) => event.currentTarget.select()} />
                    <Button variant="outline" onClick={() => void copyInvite()}>{copied ? <Check /> : <Link2 />}{copied ? "Copied" : "Copy"}</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>{isAdmin ? "Owners and admins can remove members. Removed people lose access to this workspace's reports." : "People who can open this workspace's reports."}</CardDescription>
          </CardHeader>
          <CardContent>
            {members.isPending && <Spinner aria-label="Loading members" />}
            {members.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(members.error)}</AlertDescription></Alert>}
            <ul className="grid divide-y">
              {members.data?.items.map((member) => (
                <li key={member.userId} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium uppercase">{member.email.charAt(0)}</span>
                    <span className="truncate text-sm">{member.email}{member.userId === session?.user.id && <span className="text-muted-foreground"> (you)</span>}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary" className="capitalize">{member.role}</Badge>
                    {canRemove(member) && (
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${member.email}`} onClick={() => { remove.reset(); setRemoving(member); }}><Trash2 /></Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Dialog open={removing !== undefined} onOpenChange={(open) => { if (!open) setRemoving(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.email}?</DialogTitle>
            <DialogDescription>They will no longer be able to open this workspace's reports. You can invite them again later.</DialogDescription>
          </DialogHeader>
          {remove.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(remove.error)}</AlertDescription></Alert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(undefined)}>Cancel</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
