import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Link2, Terminal, Video } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { authenticate } from "./api";
import { useSession } from "./session";

export function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useSession((state) => state.setSession);
  const [mode, setMode] = useState<"login" | "register">("login");
  const registering = mode === "register";
  const auth = useMutation({
    mutationFn: (credentials: { email: string; password: string }) => authenticate(mode, credentials),
    onSuccess: async (session) => {
      queryClient.clear();
      setSession(session);
      await navigate({ to: session.workspaceId ? "/reports" : "/workspaces", replace: true });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    auth.mutate({ email: String(form.get("email")).trim(), password: String(form.get("password")) });
  }

  return (
    <main className="grid min-h-svh place-items-center bg-sidebar p-4">
      <div className="grid w-full max-w-4xl gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card className="hidden border-0 bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between">
          <CardHeader>
            <span className="grid size-12 place-items-center rounded-xl bg-background"><img src="/logo.svg" alt="" className="size-9" /></span>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">Capture the bug.<br />Share the link.</h1>
              <p className="text-primary-foreground/80">Record a tab or take a screenshot with the Zapp extension. Your team sees exactly what happened, with the technical details attached.</p>
            </div>
            <ul className="grid gap-3 text-sm">
              {[
                [Video, "Tab recordings and screenshots in one click"],
                [Terminal, "Console, network, and user actions in sync with the video"],
                [Link2, "Share with your workspace or anyone with the link"],
                [Bot, "Let AI agents read your reports through MCP"],
              ].map(([Icon, text]) => (
                <li key={text as string} className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-foreground/15"><Icon className="size-4" /></span>
                  {text as string}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="text-xs text-primary-foreground/70">Zapp</CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <h1 className="flex items-center gap-2 text-lg font-semibold lg:hidden"><img src="/logo.svg" alt="" className="size-8" />Zapp</h1>
            <CardTitle>{registering ? "Create an account" : "Welcome back"}</CardTitle>
            <CardDescription>{registering ? "Use at least 12 characters for your password." : "Sign in to your Zapp workspaces and reports."}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                {auth.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(auth.error)}</AlertDescription></Alert>}
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input id="email" name="email" type="email" autoComplete="username" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input id="password" name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : undefined} required />
                </Field>
                <Field>
                  <Button type="submit" disabled={auth.isPending}>{registering ? "Create account" : "Sign in"}</Button>
                  <Button type="button" variant="outline" disabled={auth.isPending} onClick={() => {
                    auth.reset();
                    setMode(registering ? "login" : "register");
                  }}>{registering ? "Use an existing account" : "Create an account"}</Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
