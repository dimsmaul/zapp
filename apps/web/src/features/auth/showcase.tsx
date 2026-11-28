import { CircleAlert, MessageSquare, Play, Terminal } from "lucide-react";

const requests = [
  { method: "GET", path: "/api/cart", status: 200, time: "84 ms" },
  { method: "POST", path: "/api/orders", status: 500, time: "312 ms" },
  { method: "GET", path: "/api/profile", status: 200, time: "61 ms" },
];

const people = ["A", "R", "D"];

// The notch is one SVG shape, so its curves share a single anti-aliased edge and leave no seams:
// a 128x56 box with a rounded bottom right corner (28), and a curve (24) where it meets the picture's top
// edge and left edge. Everything is in px, so keep W, H, R and F in step with the path below.
const W = 128;
const H = 56;
const F = 24;
const notch = `M0 0H${W + F}A${F} ${F} 0 0 0 ${W} ${F}V${H - 28}A28 28 0 0 1 ${W - 28} ${H}H${F}A${F} ${F} 0 0 0 0 ${H + F}Z`;

// A static picture of what a Zapp report holds. The logo sits in a notch cut out of its top left corner.
export function AuthShowcase() {
  return (
    // The top left corner is square on purpose: the notch covers it, and a rounded corner would leave a faint arc behind it.
    <aside className="relative hidden overflow-hidden rounded-[2rem] rounded-tl-none bg-primary text-primary-foreground lg:block">
      <div className="absolute top-0 left-0 z-10" style={{ width: W + F, height: H + F }}>
        <svg aria-hidden="true" width={W + F} height={H + F} className="absolute inset-0 fill-sidebar"><path d={notch} /></svg>
        <a href="/" className="absolute top-3 left-4 flex items-center gap-2 text-lg font-semibold text-foreground">
          <img src="/logo.svg" alt="" className="size-8" />Zapp
        </a>
      </div>
      <div aria-hidden="true" className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(60%_45%_at_15%_0%,oklch(1_0_0/28%),transparent),radial-gradient(55%_50%_at_100%_100%,oklch(0_0_0/30%),transparent)]" />

      <div className="absolute top-28 left-12 max-w-sm">
        <h2 className="text-4xl font-semibold tracking-tight">Capture the bug.<br />Share the link.</h2>
        <p className="mt-3 text-primary-foreground/80">Your team sees what happened, with the console and network attached.</p>
      </div>

      <div className="absolute top-[40%] left-12 w-72 rounded-2xl bg-background p-4 text-foreground shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Checkout fails on Safari</p>
            <p className="text-xs text-muted-foreground">Recorded 2 min ago · 0:42</p>
          </div>
          <span className="mt-1.5 size-2 rounded-full bg-destructive" />
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted p-2 text-xs">
          <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"><Play className="size-3 fill-current" /></span>
          <span className="h-1 flex-1 rounded-full bg-border"><span className="block h-full w-2/5 rounded-full bg-primary" /></span>
          <span className="tabular-nums text-muted-foreground">0:17</span>
        </div>
      </div>

      <div className="absolute top-[46%] right-12 flex -space-x-3">
        {people.map((initial, index) => (
          <span key={initial} className="grid size-12 place-items-center rounded-full border-2 border-primary bg-background text-sm font-medium text-foreground shadow-lg" style={{ zIndex: people.length - index }}>{initial}</span>
        ))}
      </div>

      <div className="absolute right-12 bottom-12 left-24 rounded-2xl bg-background/95 p-4 text-foreground shadow-xl backdrop-blur">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Terminal className="size-4" />Network
          <span className="ml-auto flex items-center gap-1 text-xs font-normal text-destructive"><CircleAlert className="size-3.5" />1 failed</span>
        </div>
        <ul className="grid gap-1.5 text-xs">
          {requests.map((request) => (
            <li key={request.path} className="flex items-center gap-3 rounded-md bg-muted px-2.5 py-1.5">
              <span className="w-10 font-medium text-muted-foreground">{request.method}</span>
              <span className="flex-1 truncate font-mono">{request.path}</span>
              <span className={request.status >= 400 ? "font-medium text-destructive" : "text-muted-foreground"}>{request.status}</span>
              <span className="w-12 text-right tabular-nums text-muted-foreground">{request.time}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><MessageSquare className="size-3.5" />2 comments at 0:17</p>
      </div>
      </div>
    </aside>
  );
}
