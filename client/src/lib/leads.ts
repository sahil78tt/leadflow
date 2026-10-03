// Must match STAGES in E:\LeadFlow\server\src\models\Lead.ts
export const STAGES = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export interface Lead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  source?: string;
  stage: Stage;
  version: number;
  clientId?: string;
  createdAt: string;
}
