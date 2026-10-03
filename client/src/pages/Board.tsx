import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { api, ApiError } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { STAGES, type Lead, type Stage } from "@/lib/leads";
import BoardColumn from "@/components/BoardColumn";
import { LeadCard } from "@/components/LeadCard";
import { Button } from "@/components/ui/button";
import ConvertDialog from "@/components/ConvertDialog"; // <-- EDIT 1: added

export default function Board() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [live, setLive] = useState(false);
  const [convertId, setConvertId] = useState<string | null>(null); // <-- EDIT 2: added

  // distance: a plain click doesn't start a drag
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    let cancelled = false;
    api<{ leads: Lead[] }>("/api/leads")
      .then((r) => {
        if (cancelled) return;
        setLeads(r.leads);
        setError("");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403)
          setError("Your role has no access to the pipeline.");
        else setError(e instanceof Error ? e.message : "Failed to load leads");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Live updates. The server decides the room from our token; we only listen.
  useEffect(() => {
    const socket = connectSocket();
    let firstConnect = true;

    socket.on("connect", () => {
      setLive(true);
      if (firstConnect) firstConnect = false;
      else setRefreshKey((k) => k + 1); // reconnected: reload to catch anything missed while offline
    });
    socket.on("disconnect", () => setLive(false));

    socket.on("lead:changed", ({ lead: incoming }: { lead: Lead }) => {
      setLeads((prev) => {
        const existing = prev.find((l) => l.id === incoming.id);
        if (!existing) return [incoming, ...prev]; // a new lead
        if (existing.version >= incoming.version) return prev; // our own echo, or an older event
        return prev.map((l) => (l.id === incoming.id ? incoming : l));
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const byStage = useMemo(() => {
    const groups = Object.fromEntries(
      STAGES.map((s) => [s, [] as Lead[]]),
    ) as Record<Stage, Lead[]>;
    for (const lead of leads) groups[lead.stage].push(lead);
    return groups;
  }, [leads]);

  const activeLead = leads.find((l) => l.id === activeId) ?? null;
  const convertTarget = leads.find((l) => l.id === convertId) ?? null; // <-- EDIT 3: added

  const replace = (lead: Lead) =>
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l)));

  async function moveTo(lead: Lead, stage: Stage) {
    setPending((prev) => new Set(prev).add(lead.id));
    replace({ ...lead, stage }); // optimistic: the card moves immediately
    try {
      const r = await api<{ lead: Lead }>(`/api/leads/${lead.id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ stage, version: lead.version }),
      });
      replace(r.lead); // adopt the server's version
    } catch (e) {
      const current =
        e instanceof ApiError && e.status === 409
          ? (e.data as { lead?: Lead } | null)?.lead
          : undefined;
      if (current) {
        replace(current); // someone else moved it first: show the truth
        setNotice(
          `"${lead.name}" was moved by someone else. Showing the latest.`,
        );
      } else {
        replace(lead); // roll back
        setNotice(e instanceof Error ? e.message : "Move failed");
      }
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const lead = leads.find((l) => l.id === event.active.id);
    const target = event.over ? String(event.over.id) : null;
    if (!lead || !target || !(STAGES as readonly string[]).includes(target))
      return;
    if (lead.stage === target) return;
    void moveTo(lead, target as Stage);
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="type-heading-md">Pipeline</h1>
          <p className="text-xs text-mute">{leads.length} leads</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="flex items-center gap-1.5 text-xs text-mute"
            title={
              live ? "Receiving live updates" : "Not connected: use Refresh"
            }
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                live ? "bg-success" : "bg-faint",
              )}
            />
            {live ? "Live" : "Offline"}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="bg-card"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            Refresh
          </Button>
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className="mx-6 mt-3 rounded-md border border-border bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
        >
          {notice}
        </div>
      )}

      {loading ? (
        <p className="p-6 text-sm text-body">Loading pipeline…</p>
      ) : error ? (
        <p className="p-6 text-sm text-destructive">{error}</p>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-6">
            {STAGES.map((stage) => (
              <BoardColumn
                key={stage}
                stage={stage}
                leads={byStage[stage]}
                pending={pending}
                onConvert={(lead) => setConvertId(lead.id)} // <-- EDIT 4: added
              />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* <-- EDIT 4 (continued): dialog rendered as last child of root div */}
      {convertTarget && (
        <ConvertDialog
          key={convertTarget.id}
          lead={convertTarget}
          onClose={() => setConvertId(null)}
          onUpdated={replace}
        />
      )}
    </div>
  );
}
