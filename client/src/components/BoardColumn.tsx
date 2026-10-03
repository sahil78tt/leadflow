import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, type Lead, type Stage } from "@/lib/leads";
import { DraggableLeadCard } from "@/components/LeadCard";

export default function BoardColumn({
  stage,
  leads,
  pending,
}: {
  stage: Stage;
  leads: Lead[];
  pending: Set<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex h-full w-[272px] shrink-0 flex-col rounded-xl border bg-muted/60",
        isOver ? "border-foreground/30" : "border-transparent",
      )}
    >
      <header className="flex items-center justify-between px-3 py-3">
        <h2 className="type-eyebrow text-body">{STAGE_LABELS[stage]}</h2>
        <span className="text-xs text-mute">{leads.length}</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {leads.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-faint">No leads</p>
        )}
        {leads.map((lead) => (
          <DraggableLeadCard
            key={lead.id}
            lead={lead}
            disabled={pending.has(lead.id)}
          />
        ))}
      </div>
    </section>
  );
}
