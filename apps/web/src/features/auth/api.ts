import { request } from "@/lib/api";
import type { Session } from "./session";

type Credentials = { email: string; password: string };

export function authenticate(mode: "login" | "register", credentials: Credentials) {
  return request<Session>(`/auth/${mode}`, { method: "POST", body: credentials });
}

// A separate session for the browser extension, so signing out of either one leaves the other alone.
export function extensionSession(token: string) {
  return request<Session>("/auth/extension-session", { method: "POST", token });
}

export function logout(token: string) {
  return request<void>("/auth/logout", { method: "POST", token });
}
