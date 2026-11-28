import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/**
 * What a page or list shows when there is nothing in it yet: an icon, what is missing, and (optionally)
 * the button that fixes it. Use this instead of leaving the area blank or showing a bare line of text.
 */
export function EmptyState({ icon: Icon, title, description, children, className }: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Usually the button that creates the first item. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={`border border-dashed py-14 ${className ?? ""}`}>
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
