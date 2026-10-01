# Product Requirements Document (PRD)

## 1. Product Overview

- **Product Name:** LeadFlow
- **Version:** v0.1 (assignment MVP)
- **Product Type:** Multi-tenant B2B SaaS — lead & document management platform
- **Summary:**
  LeadFlow is a multi-tenant platform for German mortgage brokerages to capture leads from external sources, manage them through a sales pipeline, convert them into clients, and collect/verify required documents. One deployment serves many brokerages simultaneously, each fully isolated from the others' data. The core value proposition: replace inbox-and-spreadsheet lead tracking with a real-time pipeline that prevents duplicate contact, surfaces overdue follow-ups, and keeps document verification moving without blocking the client.

## 2. Target Users

- **User Groups:**
  - **Platform Admin** — manages brokerages at the platform level (out of primary build scope for this assignment; minimal/seeded)
  - **Brokerage Admin** — oversees their brokerage's pipeline and team (management UI out of scope for this build; represented via seed data/role only)
  - **Advisor** — works leads through the pipeline, converts them to clients, reviews documents
  - **Client** — the brokerage's end customer; logs in to view their case and upload documents

- **User Goals:**
  - Advisors need to see all incoming leads in one place, avoid duplicate contact, and never lose track of where a lead sits in the pipeline.
  - Clients need a simple, low-friction way to upload documents and see verification status without waiting on a blocking screen.
  - Brokerages need confidence that their data is never visible to another brokerage on the same platform.

## 3. Core Features

- **Multi-Tenant Isolation:**
  Every record (lead, client, document, task) is scoped to a `brokerageId`. Enforced at the query level via middleware, not just at the schema level — a correctly guessed record ID from another tenant still returns nothing.

- **Lead Ingestion & Duplicate Detection:**
  Leads arrive via a public webhook endpoint, simulating intake from an external tool. Incoming leads are checked against existing leads/clients in the same tenant (email/phone match) to flag duplicates and prevent duplicate advisor contact. Idempotency key prevents the same lead from being double-created on retry or burst submission.

- **Kanban Pipeline Board:**
  Drag-and-drop board with stages (New → Contacted → Qualified → Documents → Under Review → Won/Lost). Updates propagate live to every open screen via Socket.IO, scoped per-tenant via brokerage-specific rooms. Optimistic concurrency control (version field) prevents two advisors silently overwriting each other's stage move.

- **Lead → Client Conversion:**
  An advisor converts a qualified lead into a client, creating a client-facing login and case record.

- **Client Portal:**
  Clients log in to view their case and upload required documents. Scoped strictly to their own case — not just their brokerage, but their specific client record.

- **Document Upload & Background Verification:**
  Documents upload to Cloudinary; a background process (simulated: delayed, ~15% random failure, or real queue via BullMQ/Upstash if time allows) checks each document, with live status (processing/approved/failed) pushed to both client and advisor. Upload screen never blocks on verification.

- **Dashboard:**
  Aggregate pipeline counts (leads by stage, active clients, pending documents), cached and invalidated on stage change so it stays fast and current.

- **Single Automated Email Trigger:**
  One hardcoded example — a welcome email sent via Resend when a lead enters the "New" stage — demonstrating the pipeline-triggered-automation pattern without building a full admin-configurable template engine (explicitly descoped, see Section 10).

## 4. Technical Specifications

- **API Endpoints Structure (core set):**
  - `POST /api/auth/register` — user registration (role-scoped)
  - `POST /api/auth/login` — login, returns JWT
  - `POST /api/leads/webhook/:brokerageId` — external lead intake (idempotent)
  - `GET /api/leads` — list leads for authenticated user's brokerage (tenant-scoped)
  - `PATCH /api/leads/:id/stage` — move lead to new pipeline stage (version-checked)
  - `POST /api/leads/:id/convert` — convert lead to client
  - `GET /api/clients/:id/case` — client views own case (ownership + tenant checked)
  - `POST /api/documents/upload` — client uploads document (Cloudinary)
  - `GET /api/documents/:id/status` — document verification status
  - `GET /api/dashboard` — cached aggregate pipeline counts

- **Permission Matrix:**

  | Action                 | Platform Admin | Brokerage Admin | Advisor | Client             |
  | ---------------------- | -------------- | --------------- | ------- | ------------------ |
  | View all brokerages    | ✅             | ❌              | ❌      | ❌                 |
  | View brokerage's leads | ❌             | ✅              | ✅      | ❌                 |
  | Move lead stage        | ❌             | ✅              | ✅      | ❌                 |
  | Convert lead to client | ❌             | ✅              | ✅      | ❌                 |
  | View own case          | ❌             | ❌              | ❌      | ✅ (own only)      |
  | Upload documents       | ❌             | ❌              | ❌      | ✅ (own case only) |

- **Data Models (core):**
  - **User** — `email, passwordHash, role, brokerageId (null for Platform Admin)`
  - **Lead** — `brokerageId, name, email, phone, stage, version, assignedAdvisorId, duplicateOf (nullable), createdAt`
  - **Client** — `brokerageId, leadId (origin), userId (login), caseStatus`
  - **Document** — `brokerageId, clientId, fileUrl, status (processing/approved/failed), uploadedAt`

## 5. Security Features

- **Authentication:** JWT + bcrypt-hashed passwords.
- **Authorization:** Role-based middleware on every route; tenant-scoping middleware auto-injects `brokerageId` from the JWT into every query — this is the primary defense against cross-tenant data access, not just a role check.
- **Data Validation:** Zod or Joi schema validation on all incoming request bodies, including the public webhook endpoint.
- **Other:** CORS restricted to the deployed frontend origin; webhook endpoint rate-limited per brokerage to reduce (not fully solve — see Section 10) flood risk from one tenant affecting others.

## 6. File Management

- **File Upload:** Client-facing document upload (payslips, ID, bank statements), handled via Cloudinary's upload API, reasonable size/type restrictions (PDF/JPG/PNG, capped size appropriate to free-tier limits).
- **Storage:** Cloudinary (free tier) — no local file storage on the app server.
- **File Metadata:** Stored in MongoDB alongside the document record (URL, type, size, upload timestamp, verification status) — Cloudinary holds the binary, Mongo holds the reference and status.

## 7. System Health & Monitoring

- **Health Check:** `GET /api/health` — basic liveness check for deployment verification.
- **Error Logging & Reporting:** Console-level structured logging for this assignment scope (no external logging service) — sufficient for a 6-day demo; noted in Section 10 as a known simplification for a real production build.

## 8. Success Criteria

- **Metrics (for this assignment, not a live product):**
  - Core flow (lead → pipeline → client → document → verified) works end-to-end without manual DB intervention
  - Tenant isolation holds under a direct cross-tenant ID guess test
  - Real-time updates reflect across two simultaneously open browser sessions
- **Milestones:** See Section 9 — this assignment's single milestone set is effectively its MVP scope; no beta/full-launch phases apply here.
- **Quality Assurance:** Targeted automated tests (Node's built-in test runner + Supertest) on tenant isolation, duplicate detection, concurrent stage-move handling, and webhook idempotency — not full coverage; see Section 10 for what's intentionally untested.

## 9. Implementation Plan

- **Development Phases / Milestones:**
  1. Project setup + auth + role-based middleware
  2. Multi-tenancy enforcement (query-level tenant scoping)
  3. Lead ingestion (webhook) + duplicate detection
  4. Kanban board UI + drag & drop
  5. Real-time sync (Socket.IO) across pipeline board
  6. Lead → Client conversion + client portal
  7. Document upload + background verification simulation + live status
  8. Dashboard (cached, fast-loading counts)
  9. One hardcoded Resend email trigger
  10. Testing, deployment, PROMPTS.md, walkthrough video, summary

- **Timeline:** 6 days total, roughly one milestone-group per day (see day-by-day breakdown in project rules doc); final day reserved for submission packaging, not new features.

## 10. Risks & Mitigation

- **Risk: Scope overrun in a 6-day solo build.**
  Mitigation: explicit descoping of advisor/brokerage admin management UI, full admin-configurable email template system, and task automation engine — named here and in the final submission summary as deliberate cuts, not oversights.

- **Risk: Multi-tenant flood (one brokerage overwhelming the system).**
  Mitigation: basic per-tenant rate limiting on the webhook endpoint. Full load-tested isolation is out of scope for this timeline; noted as a known gap with the real fix (queue-based ingestion with per-tenant throttling) named but not built.

- **Risk: Background worker crash mid-job (document verification).**
  Mitigation: if using simulated async processing, this risk doesn't fully apply; if using real BullMQ, note retry/acknowledgment behavior as the intended fix even if not fully implemented under time pressure.

- **Risk: Prompt/process transparency requirement (assignment-specific).**
  Mitigation: all AI prompts logged unedited in PROMPTS.md per milestone, including failed attempts — treated as a submission requirement, not optional documentation.
