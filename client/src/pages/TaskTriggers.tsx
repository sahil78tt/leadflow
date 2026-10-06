import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

const STAGES = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
] as const;

type Stage = (typeof STAGES)[number];

interface Advisor {
  id: string;
  name: string;
  email: string;
  role: "advisor";
}

interface TaskTrigger {
  _id: string;
  stage: Stage;
  title: string;
  description?: string;
  assignedTo:
    | string
    | {
        _id: string;
        name: string;
        email: string;
      };
  dueInMinutes: number;
  enabled: boolean;
}

const EMPTY_FORM = {
  stage: "new" as Stage,
  title: "",
  description: "",
  assignedTo: "",
  dueInMinutes: 60,
  enabled: true,
};

function advisorInfo(trigger: TaskTrigger) {
  if (typeof trigger.assignedTo === "string") {
    return {
      _id: trigger.assignedTo,
      name: "Advisor",
      email: "",
    };
  }

  return trigger.assignedTo;
}

function formatDueTime(minutes: number) {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.round(minutes / 1440);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default function TaskTriggers() {
  const [triggers, setTriggers] = useState<TaskTrigger[]>([]);
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      const [triggerResult, advisorResult] = await Promise.all([
        api<{ triggers: TaskTrigger[] }>("/api/task-triggers"),
        api<{ advisors: Advisor[] }>("/api/auth/advisors"),
      ]);

      setTriggers(triggerResult.triggers);
      setAdvisors(advisorResult.advisors);
    } catch (e: unknown) {
      setError(
        e instanceof ApiError && e.status === 403
          ? "Only brokerage admins can manage task triggers."
          : e instanceof Error
            ? e.message
            : "Failed to load task triggers",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const saveTrigger = async () => {
    if (!form.title.trim()) {
      setError("Enter a task title.");
      return;
    }

    if (!form.assignedTo) {
      setError("Select an advisor.");
      return;
    }

    if (
      !Number.isInteger(form.dueInMinutes) ||
      form.dueInMinutes < 1 ||
      form.dueInMinutes > 525600
    ) {
      setError("Due time must be between 1 minute and 525600 minutes.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const path = editingId
        ? `/api/task-triggers/${editingId}`
        : "/api/task-triggers";

      const result = await api<{ trigger: TaskTrigger }>(path, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({
          stage: form.stage,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          assignedTo: form.assignedTo,
          dueInMinutes: form.dueInMinutes,
          enabled: form.enabled,
        }),
      });

      if (editingId) {
        setTriggers((current) =>
          current.map((item) =>
            item._id === result.trigger._id ? result.trigger : item,
          ),
        );
        setMessage("Task trigger updated.");
      } else {
        setTriggers((current) => [result.trigger, ...current]);
        setMessage("Task trigger created.");
      }

      resetForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save task trigger");
    } finally {
      setSaving(false);
    }
  };

  const editTrigger = (trigger: TaskTrigger) => {
    const advisor = advisorInfo(trigger);

    setEditingId(trigger._id);

    setForm({
      stage: trigger.stage,
      title: trigger.title,
      description: trigger.description ?? "",
      assignedTo: advisor._id,
      dueInMinutes: trigger.dueInMinutes,
      enabled: trigger.enabled,
    });

    setError("");
    setMessage("");
  };

  const toggleTrigger = async (trigger: TaskTrigger) => {
    setError("");
    setMessage("");

    try {
      const result = await api<{ trigger: TaskTrigger }>(
        `/api/task-triggers/${trigger._id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled: !trigger.enabled,
          }),
        },
      );

      setTriggers((current) =>
        current.map((item) =>
          item._id === result.trigger._id ? result.trigger : item,
        ),
      );

      setMessage(
        result.trigger.enabled
          ? "Task trigger enabled."
          : "Task trigger disabled.",
      );
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to update task trigger",
      );
    }
  };

  const deleteTrigger = async (trigger: TaskTrigger) => {
    if (
      !window.confirm(
        `Delete the "${trigger.stage}" task trigger? This cannot be undone.`,
      )
    ) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await api(`/api/task-triggers/${trigger._id}`, {
        method: "DELETE",
      });

      setTriggers((current) =>
        current.filter((item) => item._id !== trigger._id),
      );

      if (editingId === trigger._id) {
        resetForm();
      }

      setMessage("Task trigger deleted.");
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to delete task trigger",
      );
    }
  };

  const availableStages = editingId
    ? STAGES
    : STAGES.filter(
        (stage) => !triggers.some((trigger) => trigger.stage === stage),
      );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div className="space-y-0.5">
        <p className="type-eyebrow text-mute">Brokerage settings</p>

        <h1 className="type-heading-lg">Task Triggers</h1>

        <p className="max-w-3xl text-sm text-mute">
          Create automatic advisor tasks when a lead enters a pipeline stage.
          Each stage can have one task trigger.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {message && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-body">
          {message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.5fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="type-heading-md">
                {editingId ? "Edit trigger" : "New trigger"}
              </h2>

              <p className="mt-0.5 text-xs text-mute">
                Automatically assign the task to an advisor.
              </p>
            </div>

            {editingId && (
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="type-label">Pipeline stage</label>

              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.stage}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    stage: e.target.value as Stage,
                  }))
                }
              >
                {availableStages.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage.charAt(0).toUpperCase() + stage.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="type-label">Task title</label>

              <input
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.title}
                maxLength={200}
                placeholder="e.g. Call new lead"
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    title: e.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="type-label">Description</label>

              <textarea
                className="mt-1 min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.description}
                maxLength={2000}
                placeholder="Optional instructions for the advisor"
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    description: e.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="type-label">Assigned advisor</label>

              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.assignedTo}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    assignedTo: e.target.value,
                  }))
                }
              >
                <option value="">Select an advisor</option>

                {advisors.map((advisor) => (
                  <option key={advisor.id} value={advisor.id}>
                    {advisor.name} — {advisor.email}
                  </option>
                ))}
              </select>

              {advisors.length === 0 && (
                <p className="mt-1 text-xs text-mute">
                  No advisors are available in this brokerage.
                </p>
              )}
            </div>

            <div>
              <label className="type-label">Due after</label>

              <div className="mt-1 flex gap-2">
                <input
                  type="number"
                  min={1}
                  max={525600}
                  step={1}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={form.dueInMinutes}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      dueInMinutes: Number(e.target.value),
                    }))
                  }
                />

                <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-mute">
                  minutes
                </div>
              </div>

              <p className="mt-1 text-[11px] text-mute">
                60 = 1 hour · 1440 = 1 day
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    enabled: e.target.checked,
                  }))
                }
              />
              Enabled
            </label>

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                onClick={saveTrigger}
                disabled={saving || advisors.length === 0}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Create trigger"}
              </Button>

              {editingId && (
                <Button variant="outline" size="sm" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="type-heading-md">Stage automations</h2>

              <p className="mt-0.5 text-xs text-mute">
                A task is created automatically when a lead enters the stage.
              </p>
            </div>

            <span className="text-xs text-mute">
              {triggers.length} trigger{triggers.length === 1 ? "" : "s"}
            </span>
          </div>

          {loading ? (
            <p className="mt-5 text-sm text-mute">Loading...</p>
          ) : triggers.length === 0 ? (
            <p className="mt-5 text-sm text-mute">
              No task triggers yet. Create your first one on the left.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {triggers.map((trigger) => {
                const advisor = advisorInfo(trigger);

                return (
                  <div
                    key={trigger._id}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {trigger.stage}
                          </span>

                          <span
                            className={
                              trigger.enabled
                                ? "rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                                : "rounded-full bg-muted px-2 py-0.5 text-[11px] text-mute"
                            }
                          >
                            {trigger.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>

                        <h3 className="mt-1.5 truncate text-sm font-medium">
                          {trigger.title}
                        </h3>

                        {trigger.description && (
                          <p className="mt-0.5 truncate text-xs text-mute">
                            {trigger.description}
                          </p>
                        )}

                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-mute">
                          <span>
                            Advisor:{" "}
                            <span className="text-body">{advisor.name}</span>
                          </span>

                          {advisor.email && <span>{advisor.email}</span>}

                          <span>
                            Due:{" "}
                            <span className="text-body">
                              {formatDueTime(trigger.dueInMinutes)}
                            </span>
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => editTrigger(trigger)}
                        >
                          Edit
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleTrigger(trigger)}
                        >
                          {trigger.enabled ? "Disable" : "Enable"}
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteTrigger(trigger)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
