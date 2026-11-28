import { Info } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import type { Environment } from "./api";

// Plain dateStyle/timeStyle plus a time zone is fine. Adding options such as timeZoneName throws a TypeError when
// this module loads, which takes the whole report page down.
const utcFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "long", timeZone: "UTC" });
const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

function join(...parts: (string | number | undefined)[]) {
  return parts.filter((part) => part !== undefined && part !== "").join(" ");
}

/** "GMT+7", "GMT-3:30". */
function gmt(offsetMinutes: number) {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  return `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/** The capture time in UTC, with the clock time where it was recorded when the extension reported its offset. */
function timestamp(environment: Environment, createdAt: string) {
  const moment = new Date(environment.capturedAt ?? createdAt);
  if (Number.isNaN(moment.getTime())) return undefined;
  const utc = utcFormat.format(moment);
  if (environment.utcOffsetMinutes === undefined) return utc;
  const local = clockFormat.format(new Date(moment.getTime() + environment.utcOffsetMinutes * 60_000));
  return `${utc} (${local} ${gmt(environment.utcOffsetMinutes)} where it was recorded)`;
}

/** The Info tab: when, where and on what the Zapp was recorded. */
export function InfoPanel({ environment, createdAt }: { environment: Environment | null; createdAt: string }) {
  if (!environment) {
    return (
      <EmptyState icon={Info} title="No device information" description="This Zapp was recorded before device details were captured, or without the extension." className="m-4" />
    );
  }
  const rows: [string, React.ReactNode][] = [
    ["Timestamp", timestamp(environment, createdAt)],
    // The country is estimated from the device's time zone, not from an IP address.
    ["Location", [environment.country, environment.timezone, environment.language].filter(Boolean).join(" · ")],
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
