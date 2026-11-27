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
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ session }) => ({ session }),
    },
  ),
);

export function isActive(session: Session | null): session is Session {
  return Boolean(session && Date.parse(session.expiresAt) > Date.now());
}
