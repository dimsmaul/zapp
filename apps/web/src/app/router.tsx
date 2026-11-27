import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { SectionSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { isActive, useSession } from "@/features/auth/session";

const root = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl p-6">
      <Empty>
        <EmptyHeader><EmptyTitle>Page not found</EmptyTitle></EmptyHeader>
        <EmptyContent><Button asChild><Link to="/">Back to Zapp</Link></Button></EmptyContent>
      </Empty>
    </main>
  ),
});

const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: () => {
    const { session } = useSession.getState();
    if (!isActive(session)) throw redirect({ to: "/login" });
    throw redirect({ to: session.workspaceId ? "/reports" : "/workspaces" });
  },
});

const login = createRoute({
  getParentRoute: () => root,
  path: "/login",
  component: lazyRouteComponent(() => import("@/features/auth/page"), "AuthPage"),
});

const signedIn = createRoute({
  getParentRoute: () => root,
  id: "signed-in",
  component: lazyRouteComponent(() => import("./workspace-layout"), "WorkspaceLayout"),
  beforeLoad: () => {
    if (!isActive(useSession.getState().session)) throw redirect({ to: "/login" });
  },
});

const workspaces = createRoute({
  getParentRoute: () => signedIn,
  path: "/workspaces",
  component: lazyRouteComponent(() => import("@/features/workspaces/page"), "WorkspacesPage"),
});

const workspaceSettings = createRoute({
  getParentRoute: () => signedIn,
  path: "/workspace/settings",
  beforeLoad: () => {
    if (!useSession.getState().session?.workspaceId) throw redirect({ to: "/workspaces" });
  },
  component: lazyRouteComponent(() => import("@/features/workspaces/settings-page"), "WorkspaceSettingsPage"),
});

const settings = createRoute({
  getParentRoute: () => signedIn,
  path: "/settings",
  component: lazyRouteComponent(() => import("@/features/settings/page"), "SettingsPage"),
});

const invite = createRoute({
  getParentRoute: () => root,
  path: "/invite/$token",
  component: lazyRouteComponent(() => import("@/features/workspaces/invite-page"), "InvitePage"),
});

const reports = createRoute({
  getParentRoute: () => signedIn,
  path: "/reports",
  beforeLoad: () => {
    if (!useSession.getState().session?.workspaceId) throw redirect({ to: "/workspaces" });
  },
  component: lazyRouteComponent(() => import("@/features/reports/page"), "ReportsPage"),
});

const share = createRoute({
  getParentRoute: () => root,
  path: "/s/$id",
  remountDeps: ({ params }) => params.id,
  component: lazyRouteComponent(() => import("@/features/reports/share-page"), "SharePage"),
});

export const router = createRouter({
  routeTree: root.addChildren([index, login, invite, signedIn.addChildren([workspaces, workspaceSettings, settings, reports]), share]),
  defaultPreload: "intent",
  // Shown while a lazily loaded page is still being fetched.
  defaultPendingComponent: () => <div className="p-4 sm:p-6 lg:p-8"><SectionSkeleton label="Loading the page" /></div>,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
