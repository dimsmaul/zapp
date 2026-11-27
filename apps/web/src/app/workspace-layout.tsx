import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, FolderPlus, Link2, LogOut, Moon, Plus, Settings, Video } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { createWorkspace, listWorkspaces, selectWorkspace } from "@/features/workspaces/api";
import { errorMessage } from "@/lib/api";
import { type Theme, setTheme, useTheme } from "@/lib/theme";

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
  const setWorkspace = useSession((state) => state.selectWorkspace);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const theme = useTheme();
  const token = session?.token ?? "";
  const email = session?.user.email ?? "";
  const [creating, setCreating] = useState(false);
  const workspaces = useQuery({
    queryKey: ["workspaces", token],
    queryFn: ({ signal }) => listWorkspaces(token, signal),
    enabled: Boolean(token),
    staleTime: 30_000,
    retry: false,
  });
  const active = workspaces.data?.items.find((workspace) => workspace.id === session?.workspaceId);
  const select = useMutation({
    mutationFn: (id: string) => selectWorkspace(token, id),
    onSuccess: async (result) => {
      setWorkspace(result.workspaceId);
      setCreating(false);
      await navigate({ to: "/reports" });
    },
  });
  const create = useMutation({
    mutationFn: (name: string) => createWorkspace(token, name),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces", token] });
      select.mutate(workspace.id);
    },
  });
  const signOut = useMutation({
    mutationFn: () => logout(token),
    onSettled: async () => {
      queryClient.clear();
      setSession(null);
      await navigate({ to: "/login", replace: true });
    },
  });

  function addWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (name) create.mutate(name);
  }

  return (
    <>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" tooltip="Switch workspace" aria-label="Switch workspace">
                    <img src="/logo.svg" alt="" className="size-8 shrink-0" />
                    <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">{active?.name ?? "Select workspace"}</span>
                    <ChevronsUpDown className="group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
                  <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={session?.workspaceId ?? ""} onValueChange={(id) => select.mutate(id)}>
                    {workspaces.data?.items.map((workspace) => (
                      <DropdownMenuRadioItem key={workspace.id} value={workspace.id}>
                        <span className="truncate">{workspace.name}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  {session?.workspaceId && (
                    <DropdownMenuItem asChild>
                      <Link to="/workspace/settings" onClick={() => setOpenMobile(false)}><Settings />Workspace settings</Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setCreating(true)}><Plus />Create new workspace</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/reports"} tooltip="All Zapp">
                  <Link to="/reports" onClick={() => setOpenMobile(false)}><Video /><span>All Zapp</span></Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton disabled tooltip="Recording links (coming soon)">
                  <Link2 /><span className="flex-1">Recording links</span><span className="text-xs text-muted-foreground">Soon</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton disabled tooltip="Create folder (coming soon)">
                  <FolderPlus /><span className="flex-1">Create folder</span><span className="text-xs text-muted-foreground">Soon</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" tooltip={email} aria-label="Account menu">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold uppercase text-primary-foreground">{email.charAt(0) || "?"}</span>
                    <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">{email}</span>
                    <ChevronsUpDown className="group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
                  <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger><Moon />Switch theme</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                        <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem disabled><Settings />Settings<span className="ml-auto text-xs text-muted-foreground">Soon</span></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={signOut.isPending} onSelect={() => signOut.mutate()}><LogOut />Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new workspace</DialogTitle>
            <DialogDescription>Workspaces keep reports and teammates together.</DialogDescription>
          </DialogHeader>
          {(create.error || select.error) && <Alert variant="destructive"><AlertDescription>{errorMessage(create.error ?? select.error)}</AlertDescription></Alert>}
          <form className="grid gap-3" onSubmit={addWorkspace}>
            <Field orientation="vertical">
              <FieldLabel htmlFor="new-workspace-name">Workspace name</FieldLabel>
              <Input id="new-workspace-name" name="name" maxLength={50} required autoFocus />
            </Field>
            <Button type="submit" disabled={create.isPending || select.isPending}><Plus />Create workspace</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
