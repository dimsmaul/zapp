import { request } from "@/lib/api";
import type { Session } from "./session";

type Credentials = { email: string; password: string };

export function authenticate(mode: "login" | "register", credentials: Credentials) {
  return request<Session>(`/auth/${mode}`, { method: "POST", body: credentials });
}

export function logout(token: string) {
  return request<void>("/auth/logout", { method: "POST", token });
}
