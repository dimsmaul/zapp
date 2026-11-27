/** Shared look for every DevTools list (Console, Network, Action) so they stay consistent. */

export const tableText = "text-[11px] leading-5";

/** Column header that stays pinned to the top of the scrolling list. */
export function HeaderRow({ columns, labels }: { columns: string; labels: string[] }) {
  return (
    <div role="row" className={`sticky top-0 z-10 grid ${columns} border-b bg-muted font-medium text-muted-foreground`}>
      {labels.map((label) => (
        <div key={label} role="columnheader" className="truncate border-r px-2 py-1 last:border-r-0">{label}</div>
      ))}
    </div>
  );
}

export function rowClass({ selected = false, active = false, index }: { selected?: boolean; active?: boolean; index: number }) {
  const state = selected
    ? "bg-accent"
    : active
      ? "bg-primary/10 shadow-[inset_2px_0_0_0] shadow-primary"
      : `${index % 2 ? "bg-muted/20" : ""} hover:bg-muted/50`;
  return `grid w-full scroll-mt-8 items-center py-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring ${state}`;
}
