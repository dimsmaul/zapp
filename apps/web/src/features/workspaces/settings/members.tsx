import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListSkeleton } from "@/components/skeletons";
import { useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { type Member, type Workspace, changeRole, listMembers, removeMember } from "../api";

type Props = { token: string; workspace: Workspace };

export function MembersSection({ token, workspace }: Props) {
  const queryClient = useQueryClient();
  const userId = useSession((state) => state.session?.user.id);
  const role = workspace.role;
  const [removing, setRemoving] = useState<Member>();

  const key = ["workspace-members", token, workspace.id] as const;
  const members = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listMembers(token, workspace.id, signal),
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const remove = useMutation({
    mutationFn: (member: Member) => removeMember(token, workspace.id, member.userId),
    onSuccess: async () => { setRemoving(undefined); await refresh(); },
  });
  const promote = useMutation({
    mutationFn: ({ member, next }: { member: Member; next: "admin" | "member" }) => changeRole(token, workspace.id, member.userId, next),
    onSuccess: refresh,
  });

  // Mirrors the server: owners remove anyone but an owner and change roles; admins remove regular members.
  const canRemove = (member: Member) =>
    member.role !== "owner" && (role === "owner" || (role === "admin" && member.role === "member"));
  const canChangeRole = (member: Member) => role === "owner" && member.role !== "owner";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          {role === "owner" ? "Owners can change roles and remove anyone but another owner. Admins can invite and remove regular members." : "People who can open this workspace's Zapps."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {members.isPending && <ListSkeleton label="Loading members" />}
        {members.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(members.error)}</AlertDescription></Alert>}
        {promote.isError && <Alert variant="destructive" className="mb-3"><AlertDescription>{errorMessage(promote.error)}</AlertDescription></Alert>}
        <ul className="grid divide-y">
          {members.data?.items.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium uppercase">{member.email.charAt(0)}</span>
                <span className="truncate text-sm">{member.email}{member.userId === userId && <span className="text-muted-foreground"> (you)</span>}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canChangeRole(member) ? (
                  <Select value={member.role} disabled={promote.isPending} onValueChange={(next) => promote.mutate({ member, next: next as "admin" | "member" })}>
                    <SelectTrigger size="sm" aria-label={`Role of ${member.email}`} className="w-28 capitalize"><SelectValue /></SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                ) : <Badge variant="secondary" className="capitalize">{member.role}</Badge>}
                {canRemove(member) && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${member.email}`} onClick={() => { remove.reset(); setRemoving(member); }}><Trash2 /></Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog open={removing !== undefined} onOpenChange={(open) => { if (!open) setRemoving(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.email}?</DialogTitle>
            <DialogDescription>They will no longer be able to open this workspace's Zapps. You can invite them again later.</DialogDescription>
          </DialogHeader>
          {remove.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(remove.error)}</AlertDescription></Alert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(undefined)}>Cancel</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
