import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListSkeleton } from "@/components/skeletons";
import { errorMessage } from "@/lib/api";
import { listMembers } from "@/features/workspaces/api";
import { type Sharing, type Visibility, addPerson, getSharing, removePerson } from "./api";
import { visibilityOption, visibilityOptions } from "./visibility";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string;
  title: string | null;
  token: string;
  workspaceId: string;
  visibility: Visibility;
  onVisibility: (visibility: Visibility) => void;
};

const initial = (email: string | null) => (email ?? "?").charAt(0).toUpperCase();

/** Google Drive-style sharing: add workspace members to a report and choose who else can open it. */
export function ShareDialog({ open, onOpenChange, reportId, title, token, workspaceId, visibility, onVisibility }: Props) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const sharingKey = ["report-sharing", token, reportId] as const;

  const sharing = useQuery({
    queryKey: sharingKey,
    queryFn: ({ signal }) => getSharing(token, reportId, signal),
    enabled: open,
    retry: false,
  });
  const members = useQuery({
    queryKey: ["workspace-members", token, workspaceId],
    queryFn: ({ signal }) => listMembers(token, workspaceId, signal),
    enabled: open,
    staleTime: 30_000,
  });
  const update = (result: Sharing) => queryClient.setQueryData(sharingKey, result);
  const add = useMutation({
    mutationFn: (userId: string) => addPerson(token, reportId, userId),
    onSuccess: (result) => { update(result); setQuery(""); },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removePerson(token, reportId, userId),
    onSuccess: update,
  });

  const people = sharing.data?.people ?? [];
  const term = query.trim().toLowerCase();
  const candidates = (members.data?.items ?? [])
    .filter((member) => !people.some((person) => person.userId === member.userId))
    .filter((member) => !term || member.email.toLowerCase().includes(term));
  const current = visibilityOption(visibility);
  const error = sharing.error ?? members.error ?? add.error ?? remove.error;

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setQuery(""); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share “{title || "Untitled"}”</DialogTitle>
          <DialogDescription>Add workspace members and choose who else can open this report.</DialogDescription>
        </DialogHeader>
        {error != null && <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert>}

        <div className="grid gap-2">
          <Input aria-label="Add people" placeholder="Add a workspace member" value={query} onChange={(event) => setQuery(event.target.value)} />
          {term && (
            <ul className="max-h-40 overflow-auto rounded-lg border p-1" aria-label="Matching members">
              {candidates.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">No matching members.</li>}
              {candidates.map((member) => (
                <li key={member.userId}>
                  <button
                    type="button" disabled={add.isPending}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
                    onClick={() => add.mutate(member.userId)}
                  >
                    <span className="grid size-6 place-items-center rounded-full bg-muted text-xs font-medium">{initial(member.email)}</span>
                    <span className="truncate">{member.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">People with access</p>
          {sharing.isPending && <ListSkeleton label="Loading people" rows={2} />}
          <ul className="grid divide-y rounded-lg border">
            {people.map((person) => (
              <li key={person.userId} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">{initial(person.email)}</span>
                  <span className="truncate">{person.email ?? "Unknown member"}</span>
                </span>
                {person.kind === "owner"
                  ? <Badge variant="secondary">Owner</Badge>
                  : <Button variant="ghost" size="icon-xs" aria-label={`Remove ${person.email ?? "member"}`} disabled={remove.isPending} onClick={() => remove.mutate(person.userId)}><X /></Button>}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">General access</p>
          <Select value={visibility} onValueChange={(value) => onVisibility(value as Visibility)}>
            <SelectTrigger aria-label="General access" className="w-full">
              <SelectValue><span className="flex items-center gap-2"><current.Icon className="size-4" />{current.label}</span></SelectValue>
            </SelectTrigger>
            <SelectContent position="popper">
              {visibilityOptions.map(({ value, label, Icon }) => (
                <SelectItem key={value} value={value}><Icon className="size-4" />{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{current.hint}.</p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
