import type { ReactNode } from "react";

export function useSession() { return { data: null, status: "unauthenticated" as const }; }
export function SessionProvider({ children }: { children: ReactNode }) { return children; }
export async function signOut() { /* The static portfolio has no account or session. */ }
