export type NetworkRow = {
  id: string;
  name: string;
  path: string;
  host: string;
  method: string;
  status: string;
  type: string;
  durationMs: number | null;
  offsetMs: number;
  error: boolean;
};

const columns = "grid-cols-[minmax(0,2fr)_3rem_3rem_4.5rem_3.75rem_minmax(5rem,1.5fr)]";
const head = "truncate border-r px-2 py-1 last:border-r-0";
const cell = "truncate px-2 text-muted-foreground";

/** Dense request list modelled on the Chrome DevTools Network panel, with a waterfall column. */
export function NetworkTable({ rows, selectedId, onSelect }: {
  rows: NetworkRow[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const span = Math.max(1, ...rows.map((row) => row.offsetMs + (row.durationMs ?? 0)));
  return (
    <div role="table" aria-label="Network requests" className="min-w-136 text-[11px] leading-5">
      <div role="row" className={`grid ${columns} border-b bg-muted/50 font-medium text-muted-foreground`}>
        {["Name", "Method", "Status", "Type", "Time", "Waterfall"].map((label) => (
          <div key={label} role="columnheader" className={head}>{label}</div>
        ))}
      </div>
      {rows.map((row, index) => {
        const selected = row.id === selectedId;
        return (
          <button
            key={row.id} type="button" role="row" aria-selected={selected}
            title={`${row.method} ${row.path}`}
            className={`grid w-full ${columns} items-center py-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring ${selected ? "bg-accent" : `${index % 2 ? "bg-muted/20" : ""} hover:bg-muted/50`}`}
            onClick={() => onSelect(row.id)}
          >
            <span role="cell" className="truncate px-2 text-foreground/80">
              {row.name}
              <span className="ml-1.5 text-muted-foreground/70">{row.host}</span>
            </span>
            <span role="cell" className={cell}>{row.method}</span>
            <span role="cell" className={`truncate px-2 ${row.error ? "text-destructive" : "text-muted-foreground"}`}>{row.status}</span>
            <span role="cell" className={cell}>{row.type}</span>
            <span role="cell" className={cell}>{row.durationMs === null ? "—" : `${row.durationMs} ms`}</span>
            <span role="cell" className="relative mx-2 h-3" aria-hidden="true">
              <span
                className={`absolute inset-y-0.5 rounded-xs ${row.error ? "bg-destructive" : "bg-primary/50"}`}
                style={{ left: `${(row.offsetMs / span) * 100}%`, width: `${Math.max(1, ((row.durationMs ?? 0) / span) * 100)}%` }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
