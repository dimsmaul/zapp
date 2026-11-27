import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies `text` to the clipboard and briefly confirms. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline" size="sm" aria-label={label}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => undefined);
      }}
    >
      {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}
    </Button>
  );
}
