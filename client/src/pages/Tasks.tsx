import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

type TaskStatus = "pending" | "completed";

interface Task {
  id: string;
  title: string;
  description?: string;
  dueAt: string;
  status: TaskStatus;
  overdue: boolean;
  leadId:
    | string
    | {
        id: string;
        name?: string;
        email?: string;
      };
  assignedTo:
    | string
    | {
        id: string;
        name: string;
        email: string;
      };
  completedAt?: string;
  triggerStage: string;
}

function leadInfo(task: Task) {
  if (typeof task.leadId === "string") {
    return {
      id: task.leadId,
      name: "Lead",
      email: "",
    };
  }

  return task.leadId;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState<"all" | TaskStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadTasks = async (isInitial = false) => {
    if (isInitial) {
      setLoading(true);
    }

    setError("");

    try {
      const query = status === "all" ? "" : `?status=${status}`;

      const result = await api<{ tasks: Task[] }>(`/api/tasks${query}`);

      setTasks(result.tasks);
    } catch (e: unknown) {
      setError(
        e instanceof ApiError && e.status === 403
          ? "You do not have permission to view these tasks."
          : e instanceof Error
            ? e.message
            : "Failed to load tasks",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const updateTask = async (task: Task, action: "complete" | "reopen") => {
    setWorkingId(task.id);
    setError("");
    setMessage("");

    try {
      const result = await api<{ task: Task }>(
        `/api/tasks/${task.id}/${action}`,
        {
          method: "PATCH",
        },
      );

      setTasks((current) => {
        const shouldRemove =
          (status === "pending" && result.task.status === "completed") ||
          (status === "completed" && result.task.status === "pending");

        if (shouldRemove) {
          return current.filter((item) => item.id !== result.task.id);
        }

        return current.map((item) =>
          item.id === result.task.id ? result.task : item,
        );
      });

      setMessage(
        action === "complete" ? "Task marked as completed." : "Task reopened.",
      );
    } catch (e: unknown) {
      setError(
        e instanceof ApiError && e.status === 403
          ? "You do not have permission to update this task."
          : e instanceof Error
            ? e.message
            : `Failed to ${action} task`,
      );
    } finally {
      setWorkingId(null);
    }
  };

  const pendingCount = tasks.filter((task) => task.status === "pending").length;

  const overdueCount = tasks.filter(
    (task) => task.status === "pending" && task.overdue,
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="space-y-1">
        <p className="type-eyebrow text-mute">Advisor workspace</p>

        <h1 className="type-heading-lg">Tasks</h1>

        <p className="text-sm text-mute">
          Stay on top of follow-ups automatically created from your pipeline
          stages.
        </p>
      </div>

      <div className="min-h-5">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {message && <p className="text-sm text-body">{message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="type-eyebrow text-mute">Visible tasks</p>

          <p className="mt-2 text-2xl font-semibold">{tasks.length}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <p className="type-eyebrow text-mute">Pending</p>

          <p className="mt-2 text-2xl font-semibold">{pendingCount}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <p className="type-eyebrow text-mute">Overdue</p>

          <p
            className={
              overdueCount > 0
                ? "mt-2 text-2xl font-semibold text-destructive"
                : "mt-2 text-2xl font-semibold"
            }
          >
            {overdueCount}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="type-heading-md">My tasks</h2>

            <p className="mt-1 text-xs text-mute">
              Tasks are assigned to you by brokerage automation rules.
            </p>
          </div>

          <div className="flex gap-2">
            {(["pending", "completed", "all"] as const).map((option) => (
              <Button
                key={option}
                variant={status === option ? "default" : "outline"}
                size="sm"
                className="h-9 min-w-[88px]"
                onClick={() => setStatus(option)}
              >
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-6 min-h-24 flex items-center">
            <p className="text-sm text-mute">Loading tasks...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="mt-6 rounded-lg border border-border bg-muted/30 p-5">
            <p className="text-sm text-mute">
              {status === "pending"
                ? "You have no pending tasks."
                : status === "completed"
                  ? "You have no completed tasks."
                  : "No tasks found."}
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {tasks.map((task) => {
              const lead = leadInfo(task);
              const isWorking = workingId === task.id;

              return (
                <div
                  key={task.id}
                  className={
                    task.status === "pending" && task.overdue
                      ? "rounded-lg border border-destructive/50 bg-destructive/5 p-4"
                      : "rounded-lg border border-border p-4"
                  }
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            task.status === "completed"
                              ? "rounded-full bg-muted px-2 py-0.5 text-xs text-mute"
                              : task.overdue
                                ? "rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                                : "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                          }
                        >
                          {task.status === "completed"
                            ? "Completed"
                            : task.overdue
                              ? "Overdue"
                              : "Pending"}
                        </span>

                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-mute">
                          {task.triggerStage}
                        </span>
                      </div>

                      <h3 className="mt-2 font-medium">{task.title}</h3>

                      {task.description && (
                        <p className="mt-1 text-sm text-mute">
                          {task.description}
                        </p>
                      )}

                      <div className="mt-3 space-y-1 text-xs text-mute">
                        <p>
                          Lead:{" "}
                          <span className="text-body">
                            {lead.name ?? "Lead"}
                          </span>
                        </p>

                        {lead.email && <p>{lead.email}</p>}

                        <p>
                          Due:{" "}
                          <span
                            className={
                              task.status === "pending" && task.overdue
                                ? "font-medium text-destructive"
                                : "text-body"
                            }
                          >
                            {formatDate(task.dueAt)}
                          </span>
                        </p>

                        {task.completedAt && (
                          <p>
                            Completed:{" "}
                            <span className="text-body">
                              {formatDate(task.completedAt)}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex h-9 shrink-0 gap-2">
                      {task.status === "pending" ? (
                        <Button
                          size="sm"
                          disabled={isWorking}
                          className="h-9 w-[96px]"
                          onClick={() => void updateTask(task, "complete")}
                        >
                          {isWorking ? "Saving..." : "Complete"}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isWorking}
                          className="h-9 w-[96px]"
                          onClick={() => void updateTask(task, "reopen")}
                        >
                          {isWorking ? "Saving..." : "Reopen"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
