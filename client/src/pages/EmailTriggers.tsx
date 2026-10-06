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

interface EmailTemplate {
  _id: string;
  name: string;
  subject: string;
  enabled: boolean;
}

interface EmailTrigger {
  _id: string;
  stage: Stage;
  templateId:
    | string
    | {
        _id: string;
        name: string;
        subject: string;
        enabled: boolean;
      };
  enabled: boolean;
}

const EMPTY_FORM = {
  stage: "new" as Stage,
  templateId: "",
  enabled: true,
};

function templateInfo(trigger: EmailTrigger) {
  if (typeof trigger.templateId === "string") {
    return {
      _id: trigger.templateId,
      name: "Template",
      subject: "",
      enabled: true,
    };
  }

  return trigger.templateId;
}

export default function EmailTriggers() {
  const [triggers, setTriggers] = useState<EmailTrigger[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
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
      const [triggerResult, templateResult] = await Promise.all([
        api<{ triggers: EmailTrigger[] }>("/api/email-triggers"),
        api<{ templates: EmailTemplate[] }>("/api/email-templates"),
      ]);

      setTriggers(triggerResult.triggers);
      setTemplates(templateResult.templates);
    } catch (e: unknown) {
      setError(
        e instanceof ApiError && e.status === 403
          ? "Only brokerage admins can manage email triggers."
          : e instanceof Error
            ? e.message
            : "Failed to load email triggers",
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
    if (!form.templateId) {
      setError("Select an email template.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const path = editingId
        ? `/api/email-triggers/${editingId}`
        : "/api/email-triggers";

      const result = await api<{ trigger: EmailTrigger }>(path, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });

      if (editingId) {
        setTriggers((current) =>
          current.map((item) =>
            item._id === result.trigger._id ? result.trigger : item,
          ),
        );
        setMessage("Email trigger updated.");
      } else {
        setTriggers((current) => [result.trigger, ...current]);
        setMessage("Email trigger created.");
      }

      resetForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save email trigger");
    } finally {
      setSaving(false);
    }
  };

  const editTrigger = (trigger: EmailTrigger) => {
    const template = templateInfo(trigger);

    setEditingId(trigger._id);
    setForm({
      stage: trigger.stage,
      templateId: template._id,
      enabled: trigger.enabled,
    });
    setError("");
    setMessage("");
  };

  const toggleTrigger = async (trigger: EmailTrigger) => {
    setError("");
    setMessage("");

    try {
      const result = await api<{ trigger: EmailTrigger }>(
        `/api/email-triggers/${trigger._id}`,
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
          ? "Email trigger enabled."
          : "Email trigger disabled.",
      );
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to update email trigger",
      );
    }
  };

  const deleteTrigger = async (trigger: EmailTrigger) => {
    if (
      !window.confirm(
        `Delete the "${trigger.stage}" email trigger? This cannot be undone.`,
      )
    ) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await api(`/api/email-triggers/${trigger._id}`, {
        method: "DELETE",
      });

      setTriggers((current) =>
        current.filter((item) => item._id !== trigger._id),
      );

      if (editingId === trigger._id) {
        resetForm();
      }

      setMessage("Email trigger deleted.");
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to delete email trigger",
      );
    }
  };

  const availableStages = editingId
    ? STAGES
    : STAGES.filter(
        (stage) => !triggers.some((trigger) => trigger.stage === stage),
      );

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-8">
      <div className="space-y-1">
        <p className="type-eyebrow text-mute">Brokerage settings</p>
        <h1 className="type-heading-lg">Email Triggers</h1>
        <p className="text-sm text-mute">
          Connect an email template to a pipeline stage. When a lead enters that
          stage, LeadFlow sends the configured email automatically.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-body">{message}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="type-heading-md">
                {editingId ? "Edit trigger" : "New trigger"}
              </h2>
              <p className="mt-1 text-xs text-mute">
                One email trigger can be configured for each pipeline stage.
              </p>
            </div>

            {editingId && (
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="type-label">Pipeline stage</label>
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
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
              <label className="type-label">Email template</label>
              <select
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={form.templateId}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    templateId: e.target.value,
                  }))
                }
              >
                <option value="">Select a template</option>
                {templates.map((template) => (
                  <option
                    key={template._id}
                    value={template._id}
                    disabled={!template.enabled}
                  >
                    {template.name}
                    {!template.enabled ? " (disabled)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {form.templateId && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="type-eyebrow text-mute">Selected template</p>

                {(() => {
                  const selected = templates.find(
                    (template) => template._id === form.templateId,
                  );

                  if (!selected) {
                    return (
                      <p className="mt-1 text-sm text-mute">
                        Template not found.
                      </p>
                    );
                  }

                  return (
                    <>
                      <p className="mt-1 font-medium">{selected.name}</p>
                      <p className="mt-1 text-sm text-mute">
                        {selected.subject}
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

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

            {templates.length === 0 && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-sm text-mute">
                  Create an email template first before creating a trigger.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={saveTrigger}
                disabled={saving || templates.length === 0}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Create trigger"}
              </Button>

              {editingId && (
                <Button variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="type-heading-md">Stage automations</h2>
              <p className="mt-1 text-xs text-mute">
                Emails are sent when a lead moves into the configured stage.
              </p>
            </div>

            <span className="text-xs text-mute">
              {triggers.length} trigger{triggers.length === 1 ? "" : "s"}
            </span>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-mute">Loading...</p>
          ) : triggers.length === 0 ? (
            <p className="mt-6 text-sm text-mute">
              No email triggers yet. Create one on the left.
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {triggers.map((trigger) => {
                const template = templateInfo(trigger);

                return (
                  <div
                    key={trigger._id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            {trigger.stage}
                          </span>

                          <span
                            className={
                              trigger.enabled
                                ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                                : "rounded-full bg-muted px-2 py-0.5 text-xs text-mute"
                            }
                          >
                            {trigger.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>

                        <h3 className="mt-2 font-medium">{template.name}</h3>

                        {template.subject && (
                          <p className="mt-1 truncate text-sm text-mute">
                            {template.subject}
                          </p>
                        )}

                        {!template.enabled && (
                          <p className="mt-2 text-xs text-destructive">
                            The selected template is disabled.
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 gap-2">
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




