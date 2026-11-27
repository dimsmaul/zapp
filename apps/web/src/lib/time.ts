const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000], ["month", 2_592_000], ["day", 86_400], ["hour", 3600], ["minute", 60],
];

/** "3 days ago", "yesterday", or "just now" for an ISO date string. */
export function timeAgo(value: string) {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
