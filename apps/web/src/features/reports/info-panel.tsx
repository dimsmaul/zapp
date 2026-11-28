import { Info } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import type { Environment } from "./api";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short", timeZoneName: "short" });

function join(...parts: (string | number | undefined)[]) {
  return parts.filter((part) => part !== undefined && part !== "").join(" ");
}

/** The Info tab: when, where and on what the Zapp was recorded. */
export function InfoPanel({ environment, createdAt }: { environment: Environment | null; createdAt: string }) {
  if (!environment) {
    return (
      <EmptyState icon={Info} title="No device information" description="This Zapp was recorded before device details were captured, or without the extension." className="m-4" />
    );
  }
  const rows: [string, React.ReactNode][] = [
    ["Timestamp", createdAt ? dateFormat.format(new Date(createdAt)) : undefined],
    ["Location", join(environment.timezone, environment.language ? `· ${environment.language}` : undefined)],
    ["OS", join(environment.os, environment.architecture ? `(${environment.architecture})` : undefined, environment.osVersion)],
    ["Browser", join(environment.browser, environment.browserVersion)],
    ["Window size", environment.windowWidth && environment.windowHeight ? `${environment.windowWidth}x${environment.windowHeight}` : undefined],
    ["URL", environment.url && (
      <a href={environment.url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-4">{environment.url}</a>
    )],
    ["Page title", environment.title],
  ];
  return (
    <dl className="grid divide-y px-4">
      {rows.filter(([, value]) => value).map(([label, value]) => (
        <div key={label} className="grid gap-0.5 py-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
