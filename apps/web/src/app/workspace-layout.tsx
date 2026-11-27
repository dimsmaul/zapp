import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronRight, FolderOpen, Layers3, LogOut } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { logout } from "@/features/auth/api";
import { useSession } from "@/features/auth/session";
import { listWorkspaces } from "@/features/workspaces/api";

export function WorkspaceLayout() {
  return (
    <TooltipProvider>
      <SidebarProvider><WorkspaceNavigation /></SidebarProvider>
    </TooltipProvider>
  );
}

function WorkspaceNavigation() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { setOpenMobile } = useSidebar();
  const session = useSession((state) => state.session);
  const setSession = useSession((state) => state.setSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const token = session?.token ?? "";
  const workspaces = useQuery({
    queryKey: ["workspaces", token],
    queryFn: ({ signal }) => listWorkspaces(token, signal),
    enabled: Boolean(token),
    staleTime: 30_000,
    retry: false,
  });
  const active = workspaces.data?.items.find((workspace) => workspace.id === session?.workspaceId);
  const signOut = useMutation({
    mutationFn: () => logout(token),
    onSettled: async () => {
      queryClient.clear();
      setSession(null);
      await navigate({ to: "/login", replace: true });
    },
  });

  return (
    <>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip="Switch workspace">
                <Link to="/workspaces" onClick={() => setOpenMobile(false)}>
                  <Layers3 />
                  <span className="min-w-0 flex-1 truncate">{active?.name ?? "Zapp workspaces"}</span>
                  <ChevronRight />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/reports"} tooltip="Reports">
                  <Link to="/reports" onClick={() => setOpenMobile(false)}><FolderOpen /><span>Reports</span></Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/workspaces"} tooltip="Workspaces">
                  <Link to="/workspaces" onClick={() => setOpenMobile(false)}><Layers3 /><span>Workspaces</span></Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Sign out" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
                <LogOut /><span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="absolute left-3 top-4 z-10 sm:left-4">
            <SidebarTrigger aria-label="Toggle navigation" />
          </div>
          <Outlet />
        </div>
      </SidebarInset>
    </>
  );
}
