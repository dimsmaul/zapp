import { X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LinesSkeleton } from "@/components/skeletons";
import { errorMessage } from "@/lib/api";
import type { NetworkDetail } from "./api";
import { clock } from "./player";

type Header = { name: string; value: string };
type Body = { state?: string; reason?: string; value?: unknown };
type Part = Record<string, unknown> | undefined;

const tabs = [
  ["headers", "Headers"],
  ["payload", "Payload"],
  ["preview", "Preview"],
  ["response", "Response"],
  ["timing", "Timing"],
] as const;
type Tab = (typeof tabs)[number][0];

function headersOf(part: Part): Header[] {
  return Array.isArray(part?.headers) ? (part.headers as Header[]) : [];
}

// Explains why a body is missing instead of leaving the pane blank.
function bodyNote(body: Body | undefined) {
  if (!body || body.state === "unavailable") return "No body was captured for this request.";
  if (body.state === "empty") return "This request has no content.";
  if (body.state === "truncated") return "The body was too large to capture.";
  if (body.state === "omitted") return body.reason === "binary" ? "Binary data is not captured." : "Only JSON bodies are captured.";
  return null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="border-b">
      <summary className="cursor-default select-none bg-muted/50 px-3 py-1 text-xs font-semibold">{title}</summary>
      <div className="px-3 py-1.5">{children}</div>
    </details>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  if (rows.length === 0) return <p className="py-1 text-xs text-muted-foreground">None</p>;
  return (
    <dl className="grid gap-0.5 font-mono text-xs leading-5">
      {rows.map(([name, value], index) => (
        <div key={`${name}-${index}`} className="grid grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] gap-x-2">
          <dt className="font-semibold text-muted-foreground">{name}:</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function BodyView({ body, mode }: { body: Body | undefined; mode: "pretty" | "raw" }) {
  const note = bodyNote(body);
  if (note) return <p className="p-3 text-xs text-muted-foreground">{note}</p>;
  const text = mode === "pretty" ? JSON.stringify(body?.value, null, 2) : JSON.stringify(body?.value);
  return <pre className="overflow-auto p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap">{text}</pre>;
}

type Props = {
  detail: NetworkDetail | undefined;
  loading: boolean;
  error: unknown;
  onClose: () => void;
  onSeek?: (seconds: number) => void;
};

/** Chrome DevTools-style request pane: Headers, Payload, Preview, Response, Timing. */
export function NetworkInspector({ detail, loading, error, onClose, onSeek }: Props) {
  const [tab, setTab] = useState<Tab>("headers");
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const request = detail?.details?.request as Part;
  const response = detail?.details?.response as Part;
  const timing = detail?.details?.timing as Part;
  const failure = typeof detail?.details?.failure === "string" ? detail.details.failure : null;
  const status = typeof response?.status === "number" ? response.status : null;
  const ok = status !== null && status < 400 && !failure;
  const offsetMs = detail?.event.offsetMs ?? 0;
  const durationMs = typeof timing?.durationMs === "number" ? timing.durationMs : null;

  return (
    <div className="flex h-full min-h-0 flex-col" role="region" aria-label="Request details">
      <div className="flex items-center border-b bg-muted/40">
        <Button variant="ghost" size="icon-sm" className="mx-1 rounded-sm" aria-label="Close request details" onClick={onClose}><X /></Button>
        <div role="tablist" aria-label="Request detail views" className="flex overflow-x-auto">
          {tabs.map(([id, label]) => (
            <button
              key={id} type="button" role="tab" aria-selected={tab === id}
              className={`h-8 border-b-2 px-3 text-xs whitespace-nowrap ${tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setTab(id)}
            >{label}</button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && <LinesSkeleton label="Loading the request" />}
        {error != null && <div className="p-3"><Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert></div>}
        {detail && tab === "headers" && (
          <>
            <Section title="General">
              <Rows rows={[
                ["Request URL", String(request?.url ?? detail.event.data?.url ?? "—")],
                ["Request Method", String(request?.method ?? detail.event.data?.method ?? "—")],
                ["Status Code", (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${ok ? "bg-primary" : "bg-destructive"}`} aria-hidden="true" />
                    {failure ? `(failed) ${failure}` : status !== null ? `${status} ${String(response?.statusText ?? "")}`.trim() : "—"}
                  </span>
                )],
              ]} />
            </Section>
            <Section title={`Response Headers (${headersOf(response).length})`}>
              <Rows rows={headersOf(response).map((header) => [header.name, header.value])} />
            </Section>
            <Section title={`Request Headers (${headersOf(request).length})`}>
              <Rows rows={headersOf(request).map((header) => [header.name, header.value])} />
            </Section>
          </>
        )}
        {detail && tab === "payload" && <BodyView body={request?.body as Body | undefined} mode="pretty" />}
        {detail && tab === "preview" && <BodyView body={response?.body as Body | undefined} mode="pretty" />}
        {detail && tab === "response" && <BodyView body={response?.body as Body | undefined} mode="raw" />}
        {detail && tab === "timing" && (
          <Section title="Request timing">
            <Rows rows={[
              ["Started at", (
                <span className="inline-flex items-center gap-2">
                  {clock(offsetMs / 1000)}
                  {onSeek && <Button size="xs" variant="outline" onClick={() => onSeek(offsetMs / 1000)}>Jump to this moment</Button>}
                </span>
              )],
              ["Total duration", durationMs === null ? "—" : `${durationMs} ms`],
            ]} />
          </Section>
        )}
      </div>
    </div>
  );
}
