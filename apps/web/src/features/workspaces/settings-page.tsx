import { useQuery } from "@tanstack/react-query";
import { KeyRound, MailPlus, Settings2, Users } from "lucide-react";
import { useState } from "react";
import { SettingsLayout, type SettingsSection } from "@/components/settings-layout";
import { SectionSkeleton } from "@/components/skeletons";
import { useSession } from "@/features/auth/session";
import { listWorkspaces } from "./api";
import { GeneralSection } from "./settings/general";
import { InvitationsSection } from "./settings/invitations";
import { KeysSection } from "./settings/keys";
import { MembersSection } from "./settings/members";

type SectionId = "general" | "members" | "invitations" | "keys";
const sections: (SettingsSection<SectionId> & { adminOnly: boolean })[] = [
  { id: "general", label: "General", Icon: Settings2, adminOnly: false },
  { id: "members", label: "Members", Icon: Users, adminOnly: false },
  { id: "invitations", label: "Invitations", Icon: MailPlus, adminOnly: true },
  { id: "keys", label: "Capture keys", Icon: KeyRound, adminOnly: true },
];

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
  const current = visible.find((item) => item.id === section)?.id ?? visible[0]?.id;

  return (
    <SettingsLayout title="Workspace settings" caption={workspace?.name} sections={visible} current={current} onSelect={setSection}>
      {workspaces.isPending && <SectionSkeleton label="Loading workspace" />}
      {workspace && current === "general" && <GeneralSection token={token} workspace={workspace} />}
      {workspace && current === "members" && <MembersSection token={token} workspace={workspace} />}
      {workspace && current === "invitations" && <InvitationsSection token={token} workspace={workspace} />}
      {workspace && current === "keys" && <KeysSection token={token} workspace={workspace} />}
    </SettingsLayout>
  );
}
