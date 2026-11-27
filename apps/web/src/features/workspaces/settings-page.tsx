import { useQuery } from "@tanstack/react-query";
import { KeyRound, MailPlus, Settings2, Users } from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/features/auth/session";
import { listWorkspaces } from "./api";
import { GeneralSection } from "./settings/general";
import { InvitationsSection } from "./settings/invitations";
import { KeysSection } from "./settings/keys";
import { MembersSection } from "./settings/members";

const sections = [
  { id: "general", label: "General", Icon: Settings2, adminOnly: false },
  { id: "members", label: "Members", Icon: Users, adminOnly: false },
  { id: "invitations", label: "Invitations", Icon: MailPlus, adminOnly: true },
  { id: "keys", label: "Capture keys", Icon: KeyRound, adminOnly: true },
] as const;
type SectionId = (typeof sections)[number]["id"];

export function WorkspaceSettingsPage() {
  const session = useSession((state) => state.session);
  const token = session?.token ?? "";
  const [section, setSection] = useState<SectionId>("general");

  const workspaces = useQuery({
    queryKey: ["workspaces", token],
    queryFn: ({ signal }) => listWorkspaces(token, signal),
    enabled: Boolean(token),
    staleTime: 30_000,
  });
  const workspace = workspaces.data?.items.find((item) => item.id === session?.workspaceId);
  const isAdmin = workspace?.role === "owner" || workspace?.role === "admin";
  const visible = sections.filter((item) => isAdmin || !item.adminOnly);
  const current = visible.find((item) => item.id === section) ?? visible[0];

  return (
    <section className="w-full">
      <header className="flex min-h-16 items-center border-b pl-14 pr-4 sm:pl-16 sm:pr-6">
        <h1 className="text-2xl font-semibold">Workspace settings</h1>
      </header>
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:gap-10 lg:p-8">
        {/* The second sidebar: sections of this page, not of the app. */}
        <nav aria-label="Workspace settings sections" className="flex gap-1 overflow-x-auto lg:w-52 lg:shrink-0 lg:flex-col">
          {workspace && <p className="hidden truncate px-2 pb-2 text-sm font-medium lg:block">{workspace.name}</p>}
          {visible.map(({ id, label, Icon }) => (
            <button
              key={id} type="button" aria-current={current?.id === id ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${current?.id === id ? "bg-accent font-medium" : "text-muted-foreground"}`}
              onClick={() => setSection(id)}
            >
              <Icon className="size-4" />{label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl flex-1">
          {workspaces.isPending && <Spinner aria-label="Loading workspace" />}
          {workspace && current?.id === "general" && <GeneralSection token={token} workspace={workspace} />}
          {workspace && current?.id === "members" && <MembersSection token={token} workspace={workspace} />}
          {workspace && current?.id === "invitations" && <InvitationsSection token={token} workspace={workspace} />}
          {workspace && current?.id === "keys" && <KeysSection token={token} workspace={workspace} />}
        </div>
      </div>
    </section>
  );
}
