import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Session = {
  token: string;
  expiresAt: string;
  user: { id: string; email: string };
  workspaceId: string | null;
};

type SessionState = {
  session: Session | null;
  setSession: (session: Session | null) => void;
  selectWorkspace: (workspaceId: string) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      selectWorkspace: (workspaceId) => set((state) => ({
        session: state.session ? { ...state.session, workspaceId } : null,
      })),
    }),
    {
      name: "zapp.session",
      // localStorage, not sessionStorage: every tab shares the sign-in, so the page the extension opens
      // is already signed in when you are signed in anywhere else on this site.
      storage: createJSONStorage(() => localStorage),
      partialize: ({ session }) => ({ session }),
    },
  ),
);

export function isActive(session: Session | null): session is Session {
  return Boolean(session && Date.parse(session.expiresAt) > Date.now());
}
