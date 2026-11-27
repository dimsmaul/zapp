import { Globe, Lock, Users } from "lucide-react";
import type { Visibility } from "./api";

/** Who can open a report. The stored value `private` means everyone in the workspace. */
export const visibilityOptions = [
  { value: "restricted", label: "Restricted", hint: "Only you, admins, and people you add", Icon: Lock },
  { value: "private", label: "Workspace", hint: "Everyone in this workspace", Icon: Users },
  { value: "public", label: "Public", hint: "Anyone with the link", Icon: Globe },
] as const satisfies ReadonlyArray<{ value: Visibility; label: string; hint: string; Icon: typeof Lock }>;

export function visibilityOption(value: Visibility | null | undefined) {
  return visibilityOptions.find((option) => option.value === value) ?? visibilityOptions[1];
}
