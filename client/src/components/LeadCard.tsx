import { useDraggable } from "@dnd-kit/core";
import { Link } from "react-router-dom"; // <-- EDIT 1: added
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
  onConvert,
}: {
  lead: Lead;
  overlay?: boolean;
  faded?: boolean;
  onConvert?: (lead: Lead) => void;
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
      {lead.clientId ? (
        // <-- EDIT 2: replaced the static "Client" <p> with a router Link
        <Link
          to={`/clients/${lead.clientId}`}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-2 inline-block text-xs font-medium text-success-foreground hover:underline"
        >
          View client
        </Link>
      ) : (
        onConvert && (
          <button
            type="button"
            // stop the drag handle on the card from treating this click as the start of a drag
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onConvert(lead)}
            className="mt-2 cursor-pointer text-xs font-medium text-foreground hover:underline"
          >
            Convert to client
          </button>
        )
      )}
    </div>
  );
}

// Locked while its own move request is in flight, and permanently once converted.
export function DraggableLeadCard({
  lead,
  disabled,
  onConvert,
}: {
  lead: Lead;
  disabled: boolean;
  onConvert: (lead: Lead) => void;
}) {
  const converted = Boolean(lead.clientId);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: disabled || converted,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={
        disabled
          ? "cursor-progress"
          : converted
            ? "cursor-default"
            : "cursor-grab active:cursor-grabbing"
      }
    >
      <LeadCard
        lead={lead}
        faded={isDragging || disabled}
        onConvert={onConvert}
      />
    </div>
  );
}
