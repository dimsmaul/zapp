import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Send, Trash2, X } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CommentsSkeleton } from "@/components/skeletons";
import { listMembers } from "@/features/workspaces/api";
import { errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import { type CommentPage, type ReportComment, addComment, deleteComment, listComments } from "./api";
import { clock } from "./player";

type Props = {
  reportId: string;
  token: string;
  workspaceId: string;
  video: RefObject<HTMLVideoElement | null>;
  isVideo: boolean;
  onSeek: (seconds: number) => void;
};

type Suggestion =
  | { kind: "member"; userId: string; email: string }
  | { kind: "time"; text: string };

const POPUP_WIDTH = 288;
// A time such as 1:22 or 1:02:03. Typed in a comment, it becomes a link to that moment in the video.
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
const initial = (email: string | null) => (email ?? "?").charAt(0).toUpperCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toSeconds = (time: string) => time.split(":").reduce((total, part) => total * 60 + Number(part), 0);

const commentsKey = (token: string, reportId: string) => ["report-comments", token, reportId] as const;

/** The report's comments. The page and the comment list share one cache entry. */
export function useComments(token: string, reportId: string, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: commentsKey(token, reportId),
    queryFn: ({ pageParam, signal }) => listComments(token, reportId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
}

/** Moments in the video a comment points at, in milliseconds: times written in the text, and a legacy stamp. */
export function commentTimes(comment: ReportComment) {
  const typed = [...comment.body.matchAll(new RegExp(`\\b${TIME}\\b`, "g"))].map((match) => toSeconds(match[0]) * 1000);
  return [...new Set(comment.offsetMs === null ? typed : [comment.offsetMs, ...typed])];
}

const MIRRORED = [
  "box-sizing", "width", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "line-height",
  "text-transform", "word-spacing", "text-indent", "tab-size",
] as const;

/** Where the caret sits inside a textarea, found by laying the same text out in a hidden copy. */
function caretOffset(field: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(field);
  const mirror = document.createElement("div");
  for (const property of MIRRORED) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  mirror.textContent = field.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = field.value.slice(index) || ".";
  mirror.append(marker);
  document.body.append(mirror);
  const offset = {
    top: marker.offsetTop - field.scrollTop,
    left: marker.offsetLeft,
    height: Number.parseFloat(style.lineHeight) || marker.offsetHeight,
  };
  mirror.remove();
  return offset;
}

/** The comment text with @mentions highlighted and times such as 1:22 turned into links to the video. */
function Body({ comment, isVideo, onSeek }: { comment: ReportComment; isVideo: boolean; onSeek: (seconds: number) => void }) {
  const mentions = comment.mentions.flatMap((mention) => mention.email ?? []).map((email) => `@${escape(email)}`);
  const pattern = new RegExp(`(${[...mentions, `\\b${TIME}\\b`].join("|")})`, "g");
  return (
    <>
      {comment.body.split(pattern).map((part, index) => {
        if (index % 2 === 0) return part;
        if (part.startsWith("@")) return <span key={index} className="rounded bg-primary/10 px-0.5 font-medium text-primary">{part}</span>;
        return isVideo ? (
          <button
            key={index} type="button" aria-label={`Jump to ${part}`}
            className="rounded bg-primary/10 px-1 font-medium text-primary tabular-nums hover:bg-primary/20"
            onClick={() => onSeek(toSeconds(part))}
          >{part}</button>
        ) : <span key={index}>{part}</span>;
      })}
    </>
  );
}

export function Comments({ reportId, token, workspaceId, video, isVideo, onSeek }: Props) {
  const queryClient = useQueryClient();
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const listEnd = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [mentioned, setMentioned] = useState<Record<string, string>>({});
  const [anchor, setAnchor] = useState({ top: 0, left: 0, height: 20 });
  const [confirming, setConfirming] = useState<string>();

  const comments = useComments(token, reportId);
  const members = useQuery({
    queryKey: ["workspace-members", token, workspaceId],
    queryFn: ({ signal }) => listMembers(token, workspaceId, signal),
    staleTime: 30_000,
  });

  const patch = (change: (pages: CommentPage[]) => CommentPage[]) =>
    queryClient.setQueryData<InfiniteData<CommentPage, string | null>>(commentsKey(token, reportId), (old) => old && { ...old, pages: change(old.pages) });
  const add = useMutation({
    mutationFn: (input: { body: string; mentions: string[] }) => addComment(token, reportId, input),
    onSuccess: (comment) => {
      patch((pages) => pages.map((page, index) => index === pages.length - 1 ? { ...page, items: [...page.items, comment] } : page));
      setText("");
      setMentioned({});
      requestAnimationFrame(() => listEnd.current?.scrollIntoView({ block: "nearest" }));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteComment(token, reportId, id),
    onSuccess: (_, id) => {
      patch((pages) => pages.map((page) => ({ ...page, items: page.items.filter((item) => item.id !== id) })));
      setConfirming(undefined);
    },
  });

  // "@" opens the member picker, and on a video also offers the current time. "/" offers only the time.
  const before = text.slice(0, caret);
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(before)?.[1];
  const slash = isVideo ? /(?:^|\s)\/([^\s/]*)$/.exec(before)?.[1] : undefined;
  const currentTime = () => ({ kind: "time", text: clock(video.current?.currentTime ?? 0) }) as const;
  let suggestions: Suggestion[] = [];
  if (!dismissed && mention !== undefined) {
    const query = mention.toLowerCase();
    suggestions = (members.data?.items ?? [])
      .filter((member) => member.email.toLowerCase().includes(query)).slice(0, 5)
      .map((member): Suggestion => ({ kind: "member", userId: member.userId, email: member.email }));
    if (isVideo && (query === "" || "time".startsWith(query))) suggestions.push(currentTime());
  } else if (!dismissed && slash !== undefined && "time".startsWith(slash.toLowerCase())) {
    suggestions = [currentTime()];
  }

  // Keep the picker next to the caret as the text wraps and the caret moves.
  useLayoutEffect(() => {
    if (suggestions.length > 0 && field.current) setAnchor(caretOffset(field.current, caret));
  }, [caret, text, suggestions.length]);

  function pick(suggestion: Suggestion) {
    const insertion = suggestion.kind === "member" ? `@${suggestion.email} ` : `${suggestion.text} `;
    const head = before.replace(/[@/][^\s@/]*$/, () => insertion);
    setText(head + text.slice(caret));
    if (suggestion.kind === "member") setMentioned((current) => ({ ...current, [suggestion.userId]: suggestion.email }));
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(head.length, head.length);
      setCaret(head.length);
    });
  }

  function edit(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value);
    setCaret(event.target.selectionStart);
    setDismissed(false);
    setActive(0);
  }

  function submit() {
    const body = text.trim();
    if (!body || add.isPending) return;
    add.mutate({
      body,
      mentions: Object.entries(mentioned).filter(([, email]) => body.includes(`@${email}`)).map(([userId]) => userId),
    });
  }

  function keys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => (index + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(suggestions[active] ?? suggestions[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];
  const popupLeft = Math.max(0, Math.min(anchor.left, (wrap.current?.clientWidth ?? POPUP_WIDTH) - POPUP_WIDTH));
  // The input sits at the bottom of the screen, so the picker opens upward from the caret line.
  const popupBottom = (wrap.current?.clientHeight ?? 0) - (anchor.top + 1) + 6;

  return (
    <section aria-label="Comments" className="grid gap-4 border-t px-4 pt-5 sm:px-6">
      <h2 className="text-sm font-semibold">Comments{items.length > 0 && <span className="ml-1.5 font-normal text-muted-foreground">{items.length}</span>}</h2>

      {comments.isPending && <CommentsSkeleton label="Loading comments" />}
      {comments.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(comments.error)}</AlertDescription></Alert>}
      {comments.isSuccess && items.length === 0 && <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>}
      {remove.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(remove.error)}</AlertDescription></Alert>}

      <ul className="grid gap-4">
        {items.map((comment) => (
          <li key={comment.id} className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium">{initial(comment.authorEmail)}</span>
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="truncate text-sm font-medium text-foreground">{comment.authorEmail ?? "Former member"}</span>
                <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>{timeAgo(comment.createdAt)}</time>
                {comment.offsetMs !== null && isVideo && (
                  <Button type="button" size="xs" variant="outline" aria-label={`Jump to ${clock(comment.offsetMs / 1000)}`} onClick={() => onSeek((comment.offsetMs ?? 0) / 1000)}>
                    <Clock />{clock(comment.offsetMs / 1000)}
                  </Button>
                )}
              </div>
              <p className="text-sm break-words whitespace-pre-wrap"><Body comment={comment} isVideo={isVideo} onSeek={onSeek} /></p>
            </div>
            {comment.canDelete && (confirming === comment.id ? (
              <div className="flex shrink-0 items-start gap-1">
                <Button size="xs" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(comment.id)}>Delete</Button>
                <Button size="icon-xs" variant="ghost" aria-label="Keep comment" onClick={() => setConfirming(undefined)}><X /></Button>
              </div>
            ) : (
              <Button size="icon-xs" variant="ghost" className="shrink-0" aria-label="Delete comment" onClick={() => { remove.reset(); setConfirming(comment.id); }}><Trash2 /></Button>
            ))}
          </li>
        ))}
      </ul>
      {comments.hasNextPage && (
        <Button variant="outline" disabled={comments.isFetchingNextPage} onClick={() => void comments.fetchNextPage()}>Show more comments</Button>
      )}
      <div ref={listEnd} />

      {/* Stays at the bottom of the screen while a long list of comments scrolls above it. */}
      <div className="sticky bottom-0 z-10 -mx-4 grid gap-2 border-t bg-background px-4 py-3 sm:-mx-6 sm:px-6">
        <div ref={wrap} className="relative">
          <div className="rounded-xl border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <textarea
              ref={field} value={text} rows={3} maxLength={4000}
              aria-label="Write a comment"
              placeholder={isVideo ? "Write a comment. Type @ to mention someone, or / to add the current time" : "Write a comment. Type @ to mention someone"}
              className="min-h-16 w-full resize-none bg-transparent px-3 pt-3 text-sm outline-none placeholder:text-muted-foreground"
              onChange={edit}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
              onKeyDown={keys}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <span className="px-1 text-xs text-muted-foreground">{isVideo ? "Times like 1:22 link to that moment" : ""}</span>
              <Button type="button" size="sm" disabled={!text.trim() || add.isPending} onClick={submit}>
                <Send />
              </Button>
            </div>
          </div>
          {suggestions.length > 0 && (
            <ul
              role="listbox" aria-label="Suggestions"
              style={{ bottom: popupBottom, left: popupLeft, width: POPUP_WIDTH }}
              className="absolute z-10 max-w-full overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
            >
              {suggestions.map((suggestion, index) => (
                <li key={suggestion.kind === "member" ? suggestion.userId : "time"} role="option" aria-selected={index === active}>
                  <button
                    type="button" tabIndex={-1}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${index === active ? "bg-accent" : "hover:bg-accent"}`}
                    onMouseDown={(event) => { event.preventDefault(); pick(suggestion); }}
                  >
                    {suggestion.kind === "member" ? (
                      <>
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">{initial(suggestion.email)}</span>
                        <span className="truncate">{suggestion.email}</span>
                      </>
                    ) : (
                      <>
                        <Clock className="size-4 shrink-0 text-muted-foreground" />
                        <span>Current time</span>
                        <span className="ml-auto font-mono text-xs text-muted-foreground">{suggestion.text}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {add.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(add.error)}</AlertDescription></Alert>}
      </div>
    </section>
  );
}
