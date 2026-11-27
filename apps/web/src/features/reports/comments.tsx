import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Trash2, X } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, type RefObject, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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

const initial = (email: string | null) => (email ?? "?").charAt(0).toUpperCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The comment text with each @mention highlighted. */
function Body({ comment }: { comment: ReportComment }) {
  const emails = comment.mentions.flatMap((mention) => mention.email ?? []);
  if (emails.length === 0) return <>{comment.body}</>;
  const pattern = new RegExp(`(${emails.map((email) => `@${escape(email)}`).join("|")})`, "g");
  return (
    <>
      {comment.body.split(pattern).map((part, index) =>
        index % 2 ? <span key={index} className="rounded bg-primary/10 px-0.5 font-medium text-primary">{part}</span> : part)}
    </>
  );
}

export function Comments({ reportId, token, workspaceId, video, isVideo, onSeek }: Props) {
  const queryClient = useQueryClient();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [mentioned, setMentioned] = useState<Record<string, string>>({});
  const [stamp, setStamp] = useState<number | null>(null);
  const [stampOn, setStampOn] = useState(true);
  const [confirming, setConfirming] = useState<string>();

  const key = ["report-comments", token, reportId] as const;
  const comments = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => listComments(token, reportId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const members = useQuery({
    queryKey: ["workspace-members", token, workspaceId],
    queryFn: ({ signal }) => listMembers(token, workspaceId, signal),
    staleTime: 30_000,
  });

  const patch = (change: (pages: CommentPage[]) => CommentPage[]) =>
    queryClient.setQueryData<InfiniteData<CommentPage, string | null>>(key, (old) => old && { ...old, pages: change(old.pages) });
  const add = useMutation({
    mutationFn: (input: { body: string; offsetMs?: number; mentions: string[] }) => addComment(token, reportId, input),
    onSuccess: (comment) => {
      patch((pages) => pages.map((page, index) => index === pages.length - 1 ? { ...page, items: [...page.items, comment] } : page));
      setText("");
      setMentioned({});
      setStamp(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteComment(token, reportId, id),
    onSuccess: (_, id) => {
      patch((pages) => pages.map((page) => ({ ...page, items: page.items.filter((item) => item.id !== id) })));
      setConfirming(undefined);
    },
  });

  // "@" followed by letters, right before the caret, opens the member picker.
  const query = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))?.[1];
  const suggestions = query === undefined || dismissed ? [] : (members.data?.items ?? [])
    .filter((member) => member.email.toLowerCase().includes(query.toLowerCase())).slice(0, 5);

  function pick(member: { userId: string; email: string }) {
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${member.email} `);
    setText(before + text.slice(caret));
    setMentioned((current) => ({ ...current, [member.userId]: member.email }));
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(before.length, before.length);
      setCaret(before.length);
    });
  }

  function edit(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value);
    setCaret(event.target.selectionStart);
    setDismissed(false);
    setActive(0);
    if (isVideo && stamp === null) setStamp(Math.round((video.current?.currentTime ?? 0) * 1000));
  }

  function submit() {
    const body = text.trim();
    if (!body || add.isPending) return;
    add.mutate({
      body,
      mentions: Object.entries(mentioned).filter(([, email]) => body.includes(`@${email}`)).map(([userId]) => userId),
      ...(isVideo && stampOn ? { offsetMs: stamp ?? Math.round((video.current?.currentTime ?? 0) * 1000) } : {}),
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

  return (
    <section aria-label="Comments" className="grid gap-4 border-t px-4 py-5 sm:px-6">
      <h2 className="text-sm font-semibold">Comments{items.length > 0 && <span className="ml-1.5 font-normal text-muted-foreground">{items.length}</span>}</h2>

      <div className="relative">
        <div className="rounded-xl border focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          <textarea
            ref={field} value={text} rows={3} maxLength={4000}
            aria-label="Write a comment" placeholder="Write a comment or type @ to mention a teammate"
            className="min-h-16 w-full resize-none bg-transparent px-3 pt-3 text-sm outline-none placeholder:text-muted-foreground"
            onChange={edit}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onFocus={() => { if (isVideo && stamp === null) setStamp(Math.round((video.current?.currentTime ?? 0) * 1000)); }}
            onKeyDown={keys}
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            {isVideo && stamp !== null ? (
              <Button type="button" size="xs" variant={stampOn ? "secondary" : "ghost"} aria-pressed={stampOn} onClick={() => setStampOn((value) => !value)}>
                <Clock />{stampOn ? `Comment at ${clock(stamp / 1000)}` : "No timestamp"}
              </Button>
            ) : <span />}
            <Button type="button" size="sm" disabled={!text.trim() || add.isPending} onClick={submit}>Comment</Button>
          </div>
        </div>
        {suggestions.length > 0 && (
          <ul role="listbox" aria-label="Mention a teammate" className="absolute top-full left-0 z-10 mt-1 w-72 max-w-full overflow-hidden rounded-lg border bg-popover p-1 shadow-md">
            {suggestions.map((member, index) => (
              <li key={member.userId} role="option" aria-selected={index === active}>
                <button
                  type="button" tabIndex={-1}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${index === active ? "bg-accent" : "hover:bg-accent"}`}
                  onMouseDown={(event) => { event.preventDefault(); pick(member); }}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">{initial(member.email)}</span>
                  <span className="truncate">{member.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {add.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(add.error)}</AlertDescription></Alert>}
      {remove.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(remove.error)}</AlertDescription></Alert>}

      {comments.isPending && <Spinner aria-label="Loading comments" />}
      {comments.isError && <Alert variant="destructive"><AlertDescription>{errorMessage(comments.error)}</AlertDescription></Alert>}
      {comments.isSuccess && items.length === 0 && <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>}

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
              <p className="text-sm break-words whitespace-pre-wrap"><Body comment={comment} /></p>
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
    </section>
  );
}
