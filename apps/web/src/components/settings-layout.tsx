import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type SettingsSection<Id extends string> = { id: Id; label: string; Icon: LucideIcon };

/**
 * A settings page with a second sidebar: the sections of this page sit in a small nav on the left
 * and the selected section fills the rest. The app sidebar is not involved.
 */
export function SettingsLayout<Id extends string>({ title, caption, sections, current, onSelect, children }: {
  title: string;
  /** Small label above the nav, for example the workspace name. */
  caption?: string;
  sections: readonly SettingsSection<Id>[];
  current: Id | undefined;
  onSelect: (id: Id) => void;
  children: ReactNode;
}) {
  return (
    <section className="w-full">
      <header className="flex min-h-16 items-center border-b pl-14 pr-4 sm:pl-16 sm:pr-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
      </header>
      <div className="flex flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:gap-10 lg:p-8">
        <nav aria-label={`${title} sections`} className="flex gap-1 overflow-x-auto lg:w-52 lg:shrink-0 lg:flex-col">
          {caption && <p className="hidden truncate px-2 pb-2 text-sm font-medium lg:block">{caption}</p>}
          {sections.map(({ id, label, Icon }) => (
            <button
              key={id} type="button" aria-current={current === id ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${current === id ? "bg-accent font-medium" : "text-muted-foreground"}`}
              onClick={() => onSelect(id)}
            >
              <Icon className="size-4" />{label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl flex-1">{children}</div>
      </div>
    </section>
  );
}
