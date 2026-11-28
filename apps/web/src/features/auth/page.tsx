import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { signInExtension } from "@/lib/extension";
import { authenticate, extensionSession } from "./api";
import { isActive, useSession } from "./session";
import { AuthShowcase } from "./showcase";

export function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSession = useSession((state) => state.setSession);
  const [mode, setMode] = useState<"login" | "register">("login");
  const registering = mode === "register";
  const { ref, state, next } = useSearch({ from: "/login" });
  // The extension opened this page (ref=extension) with a one-off state that it checks when we hand the session back.
  const forExtension = ref === "extension" && Boolean(state);
  const current = useSession((value) => value.session);
  const handoff = useMutation({
    mutationFn: async (token: string) => {
      const session = await extensionSession(token);
      await signInExtension({ state: state ?? "", token: session.token, expiresAt: session.expiresAt, userId: session.user.id });
    },
  });
  const auth = useMutation({
    mutationFn: (credentials: { email: string; password: string }) => authenticate(mode, credentials),
    onSuccess: async (session) => {
      queryClient.clear();
      setSession(session);
      if (forExtension) return handoff.mutate(session.token);
      // A recording link sent the visitor here to sign in first. `next` is checked by the route.
      if (next) return window.location.replace(next);
      await navigate({ to: session.workspaceId ? "/reports" : "/workspaces", replace: true });
    },
  });
  // Already signed in on this site: connect the extension without asking again.
  useEffect(() => {
    if (forExtension && isActive(current) && handoff.isIdle) handoff.mutate(current.token);
  }, [forExtension, current, handoff]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    auth.mutate({ email: String(form.get("email")).trim(), password: String(form.get("password")) });
  }

  return (
    <main className="relative grid min-h-svh gap-3 bg-sidebar p-3 lg:grid-cols-2">
      <AuthShowcase />

      <section className="flex min-h-[calc(100svh-1.5rem)] flex-col p-4 sm:p-8">
        {/* On wide screens the logo sits in the notch of the picture instead. */}
        <a href="/" className="flex w-fit items-center gap-2 text-lg font-semibold lg:hidden">
          <img src="/logo.svg" alt="" className="size-8" />Zapp
        </a>
        <div className="mx-auto grid w-full max-w-sm flex-1 content-center gap-8 py-10">
          <div className="grid gap-2 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              {forExtension ? "Connect the extension" : registering ? "Create an account" : "Welcome back"}
            </h1>
            <p className="text-muted-foreground">
              {forExtension ? "Sign in on Zapp to connect the extension."
                : registering ? "Use at least 12 characters for your password." : "Sign in to your Zapp workspaces and reports."}
            </p>
          </div>
          <form onSubmit={submit}>
            <FieldGroup>
              {(auth.isError || handoff.isError) && <Alert variant="destructive"><AlertDescription>{errorMessage(auth.error ?? handoff.error)}</AlertDescription></Alert>}
              {handoff.isPending && <Alert><AlertDescription>Connecting the extension…</AlertDescription></Alert>}
              {handoff.isSuccess && <Alert><AlertDescription>The extension is connected. This tab will close.</AlertDescription></Alert>}
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="username" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 12 : undefined} required />
              </Field>
              <Field>
                <Button type="submit" disabled={auth.isPending || handoff.isPending}>{registering ? "Create account" : "Sign in"}</Button>
              </Field>
            </FieldGroup>
          </form>
        </div>

        <p className="text-sm text-muted-foreground">
          {registering ? "Already have an account? " : "New to Zapp? "}
          <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => {
            auth.reset();
            setMode(registering ? "login" : "register");
          }}>{registering ? "Sign in" : "Create an account"}</button>
        </p>
      </section>
    </main>
  );
}
