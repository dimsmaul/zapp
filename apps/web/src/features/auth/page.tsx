import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="mx-auto grid min-h-svh max-w-sm content-center gap-4 p-6">
      <h1 className="flex items-center gap-2 text-xl font-semibold"><img src="/logo.svg" alt="" className="size-8" />Zapp</h1>
      <Card>
        <CardHeader>
          <CardTitle>{registering ? "Create an account" : "Sign in"}</CardTitle>
          <CardDescription>Access your Zapp workspaces and reports.</CardDescription>
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
    </main>
  );
}
