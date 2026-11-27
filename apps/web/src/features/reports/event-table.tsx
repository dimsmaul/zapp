import { CircleAlert, Info, MousePointerClick, Terminal, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { HeaderRow, rowClass, tableText } from "./devtools-table";
import { clock } from "./player";

export type EventRow = {
  id: string;
  offsetMs: number;
  category: "action" | "console" | "network";
  /** Console level such as log, warn, or error. */
  level?: string;
  /** What happened, for example "Clicked". Shown before the text. */
  verb?: string;
  text: string;
};

const columns = "grid-cols-[3rem_minmax(0,1fr)]";

function icon(row: EventRow) {
  if (row.category === "action") return <MousePointerClick />;
  const level = row.level?.toLowerCase();
  if (level === "error") return <CircleAlert />;
  if (level === "warn" || level === "warning") return <TriangleAlert />;
  if (level === "info") return <Info />;
  return <Terminal />;
}

// Dims the markup punctuation and attribute names so the element and its values stand out.
function markup(text: string): ReactNode {
  if (!text.startsWith("<")) return text;
  return text.split(/(<[^>]*>)/).filter(Boolean).map((part, index) => {
    const tag = /^<(\/?)([\w-]+)([^>]*)>$/.exec(part);
    if (!tag) return part;
    const [, slash, name, rest] = tag;
    return (
      <span key={index}>
        <span className="text-muted-foreground">&lt;{slash}</span>
        <span className="text-foreground">{name}</span>
        {[...rest.matchAll(/([\w:-]+)=("[^"]*")|([^\s=]+)/g)].map((attribute, position) => (
          <span key={position}>
            {" "}
            <span className="text-muted-foreground">{attribute[1] ?? attribute[3]}</span>
            {attribute[2] && <><span className="text-muted-foreground">=</span><span className="text-foreground/80">{attribute[2]}</span></>}
          </span>
        ))}
        <span className="text-muted-foreground">&gt;</span>
      </span>
    );
  });
}

/** Console and Action lists: time, an icon for the kind of event, and its text. */
export function EventTable({ rows, label, activeId, onSelect }: {
  rows: EventRow[];
  label: string;
  /** The event playing at the video's current position, when following the timeline. */
  activeId?: string;
  /** Called with the event; omit when there is no recording to seek. */
  onSelect?: (row: EventRow) => void;
}) {
  return (
    <div role="table" aria-label={label} className={tableText}>
      <HeaderRow columns={columns} labels={["Time", "Event"]} />
      {rows.map((row, index) => (
        <button
          key={row.id} id={`event-${row.id}`} type="button" role="row" disabled={!onSelect}
          title={`${row.verb ?? ""} ${row.text}`.trim()}
          className={`${columns} ${rowClass({ active: row.id === activeId, index })} ${onSelect ? "cursor-pointer" : "cursor-default"}`}
          onClick={() => onSelect?.(row)}
        >
          <span role="cell" className="px-2 font-mono text-muted-foreground tabular-nums">{clock(row.offsetMs / 1000)}</span>
          <span role="cell" className={`flex min-w-0 items-center gap-2 px-2 ${row.level === "error" ? "text-destructive" : ""}`}>
            <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">{icon(row)}</span>
            <span className="truncate font-mono">
              {row.verb && <span className="mr-1.5 text-muted-foreground">{row.verb}</span>}
              {markup(row.text)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
