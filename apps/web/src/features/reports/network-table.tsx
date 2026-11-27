import { HeaderRow, rowClass, tableText } from "./devtools-table";

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
const cell = "truncate px-2 text-muted-foreground";

/** Dense request list modelled on the Chrome DevTools Network panel, with a waterfall column. */
export function NetworkTable({ rows, selectedId, activeId, onSelect }: {
  rows: NetworkRow[];
  selectedId: string | undefined;
  /** The request playing at the video's current position, when following the timeline. */
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  const span = Math.max(1, ...rows.map((row) => row.offsetMs + (row.durationMs ?? 0)));
  return (
    <div role="table" aria-label="Network requests" className={`min-w-136 ${tableText}`}>
      <HeaderRow columns={columns} labels={["Name", "Method", "Status", "Type", "Time", "Waterfall"]} />
      {rows.map((row, index) => (
        <button
          key={row.id} id={`event-${row.id}`} type="button" role="row" aria-selected={row.id === selectedId}
          title={`${row.method} ${row.path}`}
          className={`${columns} ${rowClass({ selected: row.id === selectedId, active: row.id === activeId, index })}`}
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
      ))}
    </div>
  );
}
