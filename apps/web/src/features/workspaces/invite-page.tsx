import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isActive, useSession } from "@/features/auth/session";
import { errorMessage } from "@/lib/api";
import { acceptInvitation, selectWorkspace } from "./api";

const route = getRouteApi("/invite/$token");

export function InvitePage() {
  const { token: invitation } = route.useParams();
  const session = useSession((state) => state.session);
  const setWorkspace = useSession((state) => state.selectWorkspace);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const token = isActive(session) ? session.token : undefined;

  const join = useMutation({
    mutationFn: async () => {
      const { workspaceId } = await acceptInvitation(token!, invitation);
      await selectWorkspace(token!, workspaceId);
      return workspaceId;
    },
    onSuccess: async (workspaceId) => {
      setWorkspace(workspaceId);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      await navigate({ to: "/reports" });
    },
  });

  return (
    <main className="mx-auto grid min-h-svh max-w-md place-items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Join a Zapp workspace</CardTitle>
          <CardDescription>
            {token
              ? `You're signed in as ${session?.user.email}. The invite only works for the email it was created for.`
              : "Sign in with the email address that was invited, then open this link again."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {join.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(join.error)}</AlertDescription></Alert>}
          {token
            ? <Button disabled={join.isPending} onClick={() => join.mutate()}>Join workspace</Button>
            : <Button asChild><Link to="/login">Sign in</Link></Button>}
        </CardContent>
      </Card>
    </main>
  );
}
