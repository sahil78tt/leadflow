import { Router } from "express";
import type { Types } from "mongoose";
import { z } from "zod";
import { Task } from "../models/Task.js";
import type { ITask } from "../models/Task.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { isObjectId } from "../lib/ids.js";

const router = Router();

const statusSchema = z.enum(["pending", "completed"]);

type PopulatedUser = {
  _id: Types.ObjectId;
  name: string;
  email: string;
};

type PopulatedLead = {
  _id: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  stage: string;
};

type PopulatedTask = Omit<ITask, "assignedTo" | "leadId"> & {
  _id: Types.ObjectId;
  assignedTo?: PopulatedUser | Types.ObjectId;
  leadId?: PopulatedLead | Types.ObjectId;
};

function isPopulatedUser(
  value: PopulatedTask["assignedTo"],
): value is PopulatedUser {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === "object" &&
    "name" in value &&
    "email" in value
  );
}

function isPopulatedLead(
  value: PopulatedTask["leadId"],
): value is PopulatedLead {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === "object" &&
    "name" in value &&
    "stage" in value
  );
}

function publicTask(task: PopulatedTask) {
  const now = new Date();

  return {
    id: task._id.toString(),
    leadId: isPopulatedLead(task.leadId)
      ? task.leadId._id.toString()
      : task.leadId?.toString(),

    title: task.title,
    description: task.description,

    assignedTo: isPopulatedUser(task.assignedTo)
      ? {
          id: task.assignedTo._id.toString(),
          name: task.assignedTo.name,
          email: task.assignedTo.email,
        }
      : null,

    dueAt: task.dueAt,
    status: task.status,
    completedAt: task.completedAt ?? null,
    triggerId: task.triggerId?.toString(),
    triggerStage: task.triggerStage,

    overdue:
      task.status === "pending" &&
      new Date(task.dueAt).getTime() < now.getTime(),

    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

router.get(
  "/",
  authenticate,
  requireRole("advisor", "brokerage_admin"),
  async (req, res) => {
    const filter: Record<string, unknown> = {};

    if (req.user?.role === "advisor") {
      filter.assignedTo = req.user.id;
    }

    const status = req.query.status ? String(req.query.status) : undefined;

    if (status) {
      const parsedStatus = statusSchema.safeParse(status);

      if (!parsedStatus.success) {
        return res.status(400).json({
          error: "Invalid task status",
        });
      }

      filter.status = parsedStatus.data;
    }

    const tasks = await Task.find(filter)
      .populate("assignedTo", "name email")
      .populate("leadId", "name email phone stage")
      .sort({
        status: 1,
        dueAt: 1,
        createdAt: -1,
      })
      .lean();

    return res.json({
      tasks: tasks.map((rawTask) => {
        const task = rawTask as unknown as PopulatedTask;

        return {
          ...publicTask(task),
          lead: isPopulatedLead(task.leadId)
            ? {
                id: task.leadId._id.toString(),
                name: task.leadId.name,
                email: task.leadId.email,
                phone: task.leadId.phone,
                stage: task.leadId.stage,
              }
            : null,
        };
      }),
    });
  },
);

router.patch(
  "/:taskId/complete",
  authenticate,
  requireRole("advisor", "brokerage_admin"),
  async (req, res) => {
    const taskId = String(req.params.taskId);

    if (!isObjectId(taskId)) {
      return res.status(404).json({ error: "Not found" });
    }

    const filter: Record<string, unknown> = {
      _id: taskId,
    };

    if (req.user?.role === "advisor") {
      filter.assignedTo = req.user.id;
    }

    const task = await Task.findOneAndUpdate(
      filter,
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      },
    )
      .populate("assignedTo", "name email")
      .populate("leadId", "name email phone stage");

    if (!task) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({
      task: publicTask(task as unknown as PopulatedTask),
    });
  },
);

router.patch(
  "/:taskId/reopen",
  authenticate,
  requireRole("advisor", "brokerage_admin"),
  async (req, res) => {
    const taskId = String(req.params.taskId);

    if (!isObjectId(taskId)) {
      return res.status(404).json({ error: "Not found" });
    }

    const filter: Record<string, unknown> = {
      _id: taskId,
    };

    if (req.user?.role === "advisor") {
      filter.assignedTo = req.user.id;
    }

    const task = await Task.findOneAndUpdate(
      filter,
      {
        $set: {
          status: "pending",
        },
        $unset: {
          completedAt: 1,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    )
      .populate("assignedTo", "name email")
      .populate("leadId", "name email phone stage");

    if (!task) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({
      task: publicTask(task as unknown as PopulatedTask),
    });
  },
);

export default router;
