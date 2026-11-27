import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** Wraps placeholders so assistive technology announces that content is loading. */
export function Loading({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <div role="status" aria-busy="true" aria-label={label} className={className}>{children}</div>;
}

const widths = ["w-3/4", "w-1/2", "w-5/6", "w-2/5", "w-2/3", "w-3/5", "w-4/5"];

/** List rows with an optional avatar, a main line, and a shorter one: members, people, tokens, keys. */
export function ListSkeleton({ label, rows = 3, avatar = true }: { label: string; rows?: number; avatar?: boolean }) {
  return (
    <Loading label={label} className="grid divide-y">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-2.5">
          {avatar && <Skeleton className="size-8 shrink-0 rounded-full" />}
          <div className="grid flex-1 gap-1.5">
            <Skeleton className={`h-3.5 ${widths[index % widths.length]} max-w-72`} />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </Loading>
  );
}

/** The grid of report cards on All Zapp. */
export function CardGridSkeleton({ label, count = 8 }: { label: string; count?: number }) {
  return (
    <Loading label={label} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="grid gap-2">
          <Skeleton className="aspect-video rounded-xl" />
          <div className="grid gap-1.5 px-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </Loading>
  );
}

/** Rows of the Console, Network, and Action lists: a time and a line of text. */
export function EventRowsSkeleton({ label, rows = 8 }: { label: string; rows?: number }) {
  return (
    <Loading label={label} className="grid gap-1 py-1">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-1.5">
          <Skeleton className="h-3 w-9 shrink-0" />
          <Skeleton className="size-3.5 shrink-0 rounded-full" />
          <Skeleton className={`h-3 ${widths[index % widths.length]}`} />
        </div>
      ))}
    </Loading>
  );
}

/** Comments: an avatar, a name line, and a couple of lines of text. */
export function CommentsSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <Loading label={label} className="grid gap-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className={`h-3 ${widths[index % widths.length]}`} />
          </div>
        </div>
      ))}
    </Loading>
  );
}

/** Stacked blocks standing in for the cards of a settings section. */
export function SectionSkeleton({ label, blocks = 2 }: { label: string; blocks?: number }) {
  return (
    <Loading label={label} className="grid gap-6">
      {Array.from({ length: blocks }, (_, index) => (
        <div key={index} className="grid gap-4 rounded-xl border p-6">
          <div className="grid gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3.5 w-3/5 max-w-md" />
          </div>
          <Skeleton className="h-9 w-full max-w-sm" />
        </div>
      ))}
    </Loading>
  );
}

/** A few lines of a request's headers or body. */
export function LinesSkeleton({ label, lines = 6 }: { label: string; lines?: number }) {
  return (
    <Loading label={label} className="grid gap-2 p-3">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={`h-3.5 ${widths[index % widths.length]}`} />
      ))}
    </Loading>
  );
}

/** The report page while it loads: header, video, title, and the DevTools panel. */
export function ReportPageSkeleton() {
  return (
    <div className="min-h-svh bg-sidebar p-2 lg:h-svh">
      <Loading label="Loading the report" className="grid min-h-[calc(100svh-1rem)] overflow-hidden rounded-xl bg-background shadow-sm lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,3fr)_minmax(23rem,2fr)]">
        <div className="grid min-w-0 grid-rows-[auto_1fr] lg:min-h-0">
          <div className="flex min-h-16 items-center justify-between border-b px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2"><Skeleton className="size-8 rounded-lg" /><Skeleton className="h-5 w-24" /></div>
            <Skeleton className="h-8 w-28" />
          </div>
          <div className="grid content-start gap-4 p-4 sm:p-6">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
        <div className="border-t lg:border-t-0 lg:border-l">
          <div className="flex min-h-16 items-center border-b px-4"><Skeleton className="h-5 w-24" /></div>
          <div className="flex gap-2 border-b px-4 py-3"><Skeleton className="h-7 w-20" /><Skeleton className="h-7 w-20" /><Skeleton className="h-7 w-20" /></div>
          <div className="px-1"><EventRowsSkeleton label="Loading diagnostics" rows={10} /></div>
        </div>
      </Loading>
    </div>
  );
}
