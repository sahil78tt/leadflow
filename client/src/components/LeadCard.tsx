import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, type Lead, type Stage } from "@/lib/leads";

const STAGE_BADGE: Record<Stage, string> = {
  new: "bg-success-soft text-success-foreground",
  contacted: "bg-muted text-body",
  qualified: "bg-muted text-body",
  proposal: "bg-warning-soft text-warning-foreground",
  won: "bg-success text-primary-foreground",
  lost: "bg-destructive/10 text-destructive-foreground",
};

export function LeadCard({
  lead,
  overlay = false,
  faded = false,
}: {
  lead: Lead;
  overlay?: boolean;
  faded?: boolean;
}) {
  return (
    <div
      className={cn(
        "select-none rounded-xl border border-border bg-card p-3 text-left shadow-sm",
        overlay && "shadow-md",
        faded && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="type-label truncate">{lead.name}</p>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
            STAGE_BADGE[lead.stage],
          )}
        >
          {STAGE_LABELS[lead.stage]}
        </span>
      </div>
      {lead.email && (
        <p className="mt-1 truncate text-xs text-body">{lead.email}</p>
      )}
      {lead.phone && <p className="truncate text-xs text-body">{lead.phone}</p>}
      <div className="mt-2 flex items-center justify-between text-xs text-mute">
        <span>{lead.source ?? "Direct"}</span>
        <span>{new Date(lead.createdAt).toLocaleDateString("de-DE")}</span>
      </div>
    </div>
  );
}

// A card locked while its own move request is in flight (disabled), so a fast second drag can't send a stale version.
export function DraggableLeadCard({
  lead,
  disabled,
}: {
  lead: Lead;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={
        disabled ? "cursor-progress" : "cursor-grab active:cursor-grabbing"
      }
    >
      <LeadCard lead={lead} faded={isDragging || disabled} />
    </div>
  );
}
