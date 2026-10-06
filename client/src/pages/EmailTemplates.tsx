import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EmailTemplate {
  _id: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  enabled: boolean;
}

interface Preview {
  subject: string;
  htmlBody: string;
  textBody?: string;
}

const EMPTY_FORM = {
  name: "",
  subject: "",
  htmlBody: "",
  textBody: "",
  enabled: true,
};

const PLACEHOLDERS = [
  "{{clientName}}",
  "{{advisorName}}",
  "{{leadName}}",
  "{{brokerageName}}",
];

export default function EmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadTemplates = async () => {
    setLoading(true);

    try {
      const result = await api<{ templates: EmailTemplate[] }>(
        "/api/email-templates",
      );

      setTemplates(result.templates);
      setError("");
    } catch (e: unknown) {
      setError(
        e instanceof ApiError && e.status === 403
          ? "Only brokerage admins can manage email templates."
          : e instanceof Error
            ? e.message
            : "Failed to load email templates",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setPreview(null);
  };

  const saveTemplate = async () => {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const path = editingId
        ? `/api/email-templates/${editingId}`
        : "/api/email-templates";

      const result = await api<{ template: EmailTemplate }>(path, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });

      if (editingId) {
        setTemplates((current) =>
          current.map((item) =>
            item._id === result.template._id ? result.template : item,
          ),
        );
        setMessage("Email template updated.");
      } else {
        setTemplates((current) => [result.template, ...current]);
        setMessage("Email template created.");
      }

      resetForm();
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to save email template",
      );
    } finally {
      setSaving(false);
    }
  };

  const editTemplate = (template: EmailTemplate) => {
    setEditingId(template._id);

    setForm({
      name: template.name,
      subject: template.subject,
      htmlBody: template.htmlBody,
      textBody: template.textBody ?? "",
      enabled: template.enabled,
    });

    setPreview(null);
    setMessage("");
    setError("");
  };

  const toggleTemplate = async (template: EmailTemplate) => {
    setError("");
    setMessage("");

    try {
      const result = await api<{ template: EmailTemplate }>(
        `/api/email-templates/${template._id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: !template.enabled }),
        },
      );

      setTemplates((current) =>
        current.map((item) =>
          item._id === result.template._id ? result.template : item,
        ),
      );

      setMessage(
        result.template.enabled ? "Template enabled." : "Template disabled.",
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update template");
    }
  };

  const deleteTemplate = async (template: EmailTemplate) => {
    if (!window.confirm(`Delete "${template.name}"? This cannot be undone.`)) {
      return;
    }

    setError("");
    setMessage("");

    try {
      await api(`/api/email-templates/${template._id}`, {
        method: "DELETE",
      });

      setTemplates((current) =>
        current.filter((item) => item._id !== template._id),
      );

      if (editingId === template._id) {
        resetForm();
      }

      setMessage("Email template deleted.");
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to delete email template",
      );
    }
  };

  const previewTemplate = async () => {
    if (!editingId) {
      setError("Save the template first, then preview it.");
      return;
    }

    setError("");
    setMessage("");

    try {
      const result = await api<Preview>(
        `/api/email-templates/${editingId}/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            clientName: "Alex Client",
            advisorName: "Jordan Advisor",
            leadName: "Alex Client",
            brokerageName: "ABC Insurance",
          }),
        },
      );

      setPreview(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate preview");
    }
  };

  const previewExistingTemplate = async (template: EmailTemplate) => {
    setError("");
    setMessage("");

    try {
      const result = await api<Preview>(
        `/api/email-templates/${template._id}/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            clientName: "Alex Client",
            advisorName: "Jordan Advisor",
            leadName: "Alex Client",
            brokerageName: "ABC Insurance",
          }),
        },
      );

      setPreview(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate preview");
    }
  };

  return (
    <div className="h-[100dvh] overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 p-8">
        <div className="space-y-1">
          <p className="type-eyebrow text-mute">Brokerage settings</p>

          <h1 className="type-heading-lg">Email Templates</h1>

          <p className="text-sm text-mute">
            Create reusable emails for your brokerage. Templates can be
            connected to pipeline stages through Email Triggers.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {message && <p className="text-sm text-body">{message}</p>}

        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="type-heading-md">
                  {editingId ? "Edit template" : "New template"}
                </h2>

                <p className="mt-1 text-xs text-mute">
                  Use the supported placeholders below.
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
                <label className="type-label">Template name</label>

                <Input
                  className="mt-1"
                  value={form.name}
                  maxLength={120}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      name: e.target.value,
                    }))
                  }
                  placeholder="Welcome email"
                />
              </div>

              <div>
                <label className="type-label">Subject</label>

                <Input
                  className="mt-1"
                  value={form.subject}
                  maxLength={300}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      subject: e.target.value,
                    }))
                  }
                  placeholder="Welcome, {{clientName}}"
                />
              </div>

              <div>
                <label className="type-label">HTML body</label>

                <textarea
                  className="mt-1 min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={form.htmlBody}
                  maxLength={50000}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      htmlBody: e.target.value,
                    }))
                  }
                  placeholder="<p>Hello {{clientName}},</p>"
                />
              </div>

              <div>
                <label className="type-label">Plain-text body</label>

                <textarea
                  className="mt-1 min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={form.textBody}
                  maxLength={50000}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      textBody: e.target.value,
                    }))
                  }
                  placeholder="Hello {{clientName}},"
                />
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

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="type-eyebrow text-mute">Supported placeholders</p>

                <div className="mt-2 flex flex-wrap gap-2">
                  {PLACEHOLDERS.map((placeholder) => (
                    <code
                      key={placeholder}
                      className="rounded bg-background px-2 py-1 text-xs"
                    >
                      {placeholder}
                    </code>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={saveTemplate} disabled={saving}>
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Save changes"
                      : "Create template"}
                </Button>

                {editingId && (
                  <Button variant="outline" onClick={previewTemplate}>
                    Preview
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="type-heading-md">Your templates</h2>

                  <p className="mt-1 text-xs text-mute">
                    Only templates belonging to this brokerage are shown.
                  </p>
                </div>

                <span className="text-xs text-mute">
                  {templates.length} template
                  {templates.length === 1 ? "" : "s"}
                </span>
              </div>

              {loading ? (
                <p className="mt-6 text-sm text-mute">Loading...</p>
              ) : templates.length === 0 ? (
                <p className="mt-6 text-sm text-mute">
                  No templates yet. Create your first one on the left.
                </p>
              ) : (
                <div className="mt-5 space-y-3">
                  {templates.map((template) => (
                    <div
                      key={template._id}
                      className="rounded-lg border border-border p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">{template.name}</h3>

                            <span
                              className={
                                template.enabled
                                  ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                                  : "rounded-full bg-muted px-2 py-0.5 text-xs text-mute"
                              }
                            >
                              {template.enabled ? "Enabled" : "Disabled"}
                            </span>
                          </div>

                          <p className="mt-1 truncate text-sm text-mute">
                            {template.subject}
                          </p>
                        </div>

                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => previewExistingTemplate(template)}
                          >
                            Preview
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => editTemplate(template)}
                          >
                            Edit
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleTemplate(template)}
                          >
                            {template.enabled ? "Disable" : "Enable"}
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteTemplate(template)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {preview && (
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="type-eyebrow text-mute">Preview</p>

                    <h2 className="mt-1 type-heading-md">{preview.subject}</h2>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreview(null)}
                  >
                    Close
                  </Button>
                </div>

                <div
                  className="prose prose-sm mt-5 max-w-none rounded-lg border border-border bg-background p-5"
                  dangerouslySetInnerHTML={{ __html: preview.htmlBody }}
                />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
