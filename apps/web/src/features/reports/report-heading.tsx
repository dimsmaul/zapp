import { Pencil } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/time";

type Props = {
  title: string | null;
  description: string | null;
  reporter: string | null;
  createdAt: string;
  /** Owners, admins, and the reporter can rename the report and edit its description. */
  canEdit: boolean;
  onSave: (changes: { title: string; description: string }) => Promise<unknown>;
};

const textarea = "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Title, description, and who made the report, with inline editing for people who may change it. */
export function ReportHeading({ title, description, reporter, createdAt, canEdit, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(undefined);
    try {
      await onSave({ title: String(form.get("title")).trim(), description: String(form.get("description")).trim() });
      setEditing(false);
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="grid gap-3 border-t px-4 py-5 sm:px-6">
      {editing ? (
        <form className="grid gap-3" onSubmit={submit}>
          <Input aria-label="Title" name="title" defaultValue={title ?? ""} maxLength={200} required autoFocus className="h-10 text-lg font-semibold" />
          <textarea aria-label="Description" name="description" defaultValue={description ?? ""} rows={4} maxLength={12000} placeholder="Add a description…" className={textarea} />
          {error != null && <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert>}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>Save</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => { setError(undefined); setEditing(false); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <h1 className="break-words text-2xl font-semibold">{title || "Untitled report"}</h1>
            {canEdit && (
              <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Edit title and description" onClick={() => setEditing(true)}><Pencil /></Button>
            )}
          </div>
          {description
            ? <p className="whitespace-pre-wrap break-words text-muted-foreground">{description}</p>
            : canEdit && <button type="button" className="w-fit text-left text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>Add a description…</button>}
        </>
      )}
      <p className="border-t pt-3 text-xs text-muted-foreground">
        {reporter && <span className="font-medium text-foreground">{reporter} </span>}
        created this report · <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>{timeAgo(createdAt)}</time>
      </p>
    </article>
  );
}
