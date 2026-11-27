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

/** Dense request list modelled on the Chrome DevTools Network panel, with a waterfall column. */
export function NetworkTable({ rows, selectedId, onSelect }: {
  rows: NetworkRow[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const span = Math.max(1, ...rows.map((row) => row.offsetMs + (row.durationMs ?? 0)));
  return (
    <div role="table" aria-label="Network requests" className="min-w-136 text-xs">
      <div role="row" className={`grid ${columns} border-b bg-muted/60 font-medium`}>
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
            className={`grid w-full ${columns} items-center text-left font-mono outline-none focus-visible:ring-1 focus-visible:ring-sky-500 ${selected ? "bg-sky-600 text-white" : `${index % 2 ? "bg-muted/30" : ""} ${row.error ? "text-red-600 dark:text-red-400" : ""} hover:bg-muted/70`}`}
            onClick={() => onSelect(row.id)}
          >
            <span role="cell" className="truncate px-2 py-0.5">
              {row.name}
              <span className={`ml-1.5 ${selected ? "text-white/70" : "text-muted-foreground"}`}>{row.host}</span>
            </span>
            <span role="cell" className="truncate px-2">{row.method}</span>
            <span role="cell" className="truncate px-2">{row.status}</span>
            <span role="cell" className="truncate px-2">{row.type}</span>
            <span role="cell" className="truncate px-2">{row.durationMs === null ? "—" : `${row.durationMs} ms`}</span>
            <span role="cell" className="relative mx-2 h-3" aria-hidden="true">
              <span
                className={`absolute inset-y-0.5 rounded-xs ${row.error ? "bg-red-500" : selected ? "bg-white" : "bg-sky-500"}`}
                style={{ left: `${(row.offsetMs / span) * 100}%`, width: `${Math.max(1, ((row.durationMs ?? 0) / span) * 100)}%` }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
