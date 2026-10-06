# LeadFlow

<p align="center">
  Multi-tenant lead and document platform for mortgage brokerages.
</p>

<p align="center">
  <a href="https://leadflow-one-opal.vercel.app/">
    <img src="https://img.shields.io/badge/Live%20Demo-LeadFlow-5e6ad2?style=for-the-badge" alt="Live Demo" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-TypeScript-61DAFB?style=for-the-badge&logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white" />
  <img src="https://img.shields.io/badge/Socket.IO-Realtime-black?style=for-the-badge&logo=socket.io&logoColor=white" />
  <img src="https://img.shields.io/badge/Redis-Upstash-DC382D?style=for-the-badge&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/Cloudinary-Documents-3448C5?style=for-the-badge&logo=cloudinary&logoColor=white" />
  <img src="https://img.shields.io/badge/Resend-Email-black?style=for-the-badge" />
</p>

---

## What is LeadFlow?

LeadFlow is a MERN-based multi-tenant platform for mortgage brokerages.

It handles the workflow from **lead → advisor pipeline → client → documents**.

The application supports multiple brokerages from the same deployment while keeping their users and data isolated.

---

## Features

- **Multi-Tenant Architecture**
  - Each brokerage has isolated users, leads, clients, documents, templates and tasks.
  - Tenant context is taken from the authenticated user and applied to database queries.

- **External Lead Ingestion**
  - Google Forms → Google Sheets → Apps Script → LeadFlow webhook.
  - Leads are added automatically to the pipeline.

- **Duplicate Lead Detection**
  - Email and phone numbers are normalized.
  - Database constraints prevent duplicate leads.
  - Webhook also supports `Idempotency-Key`.

- **Live Pipeline**
  - Leads move through:
    `New → Contacted → Qualified → Proposal → Won / Lost`
  - Socket.IO keeps the pipeline updated across open screens.

- **Concurrent Updates**
  - Lead stage updates use a version check.
  - If two advisors update the same lead, one update is rejected instead of silently overwriting the other.

- **Lead to Client Conversion**
  - An advisor can convert a lead into a client.
  - Client login and lead conversion are created together using a MongoDB transaction.

- **Client Documents**
  - Clients can upload documents from the portal.
  - Files are stored privately using Cloudinary.
  - Documents have live checking status.

- **Background Document Checks**
  - Document checking is simulated asynchronously.
  - Status moves through:
    `pending → checking → verified / failed`
  - Checks can fail intentionally to simulate real processing.

- **Dashboard**
  - Pipeline counts are cached using Upstash Redis.
  - Cache invalidation uses an epoch version so stale requests do not overwrite newer data.

- **Email Templates**
  - Brokerage admins can create, edit, enable/disable and delete templates.
  - Supports placeholders such as:
    `{{clientName}}`, `{{advisorName}}`, `{{leadName}}`, `{{brokerageName}}`

- **Email Triggers**
  - An email template can be linked to a pipeline stage.
  - When a lead enters that stage, the configured email is sent through Resend.
  - Email delivery status is stored to prevent duplicate sends.
  - A failed send is recorded and does not roll back the stage change.

- **Task Triggers**
  - Brokerage admins can configure a task for a pipeline stage (one trigger per stage).
  - Tasks contain an assigned advisor and due time.
  - Duplicate task creation is prevented.

- **Advisor Tasks**
  - Advisors can see their assigned tasks.
  - Tasks can be completed or reopened.
  - Overdue pending tasks are highlighted.

---

## Tech Stack

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- Shadcn UI
- React Router

### Backend

- Node.js
- Express 5
- TypeScript
- Mongoose
- JWT
- bcrypt
- Socket.IO

### Services

- MongoDB Atlas
- Upstash Redis
- Cloudinary
- Resend
- Google Forms / Google Sheets / Apps Script

### Deployment

- Vercel — Frontend
- Render — Backend

---

## Architecture

```text
Google Form
    ↓
Google Sheet
    ↓
Apps Script
    ↓
LeadFlow Webhook
    ↓
Express API
    ├── MongoDB Atlas
    ├── Upstash Redis
    ├── Cloudinary
    ├── Resend
    └── Socket.IO
          ↓
     React Frontend
```

The backend uses the authenticated user's `brokerageId` to keep brokerage data isolated.

---

## Project Structure

```text
LeadFlow/
│
├── client/
│   └── src/
│       ├── components/
│       ├── context/
│       ├── lib/
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── EmailTemplates.tsx
│       │   ├── EmailTriggers.tsx
│       │   ├── TaskTriggers.tsx
│       │   └── Tasks.tsx
│       └── App.tsx
│
├── server/
│   └── src/
│       ├── lib/
│       │   ├── tenantPlugin.ts
│       │   ├── stageAutomations.ts
│       │   └── taskAutomations.ts
│       ├── models/
│       │   ├── Lead.ts
│       │   ├── Client.ts
│       │   ├── Document.ts
│       │   ├── EmailTemplate.ts
│       │   ├── EmailTrigger.ts
│       │   ├── EmailDelivery.ts
│       │   ├── Task.ts
│       │   └── TaskTrigger.ts
│       ├── routes/
│       │   ├── auth.ts
│       │   ├── leads.ts
│       │   ├── documents.ts
│       │   ├── dashboard.ts
│       │   ├── emailTemplates.ts
│       │   ├── emailTriggers.ts
│       │   ├── taskTriggers.ts
│       │   └── tasks.ts
│       └── app.ts
│
├── PROMPTS.md
├── SUMMARY.md
└── README.md
```

---

## User Roles

| Role            | What they can do                                                                           |
| --------------- | ------------------------------------------------------------------------------------------ |
| Platform Admin  | Platform-level access across brokerages (not tenant-scoped); admin UI is minimal           |
| Brokerage Admin | Own brokerage only: email templates and triggers, task triggers, plus lead/task visibility |
| Advisor         | Own brokerage only: leads, pipeline, lead → client conversion and assigned tasks           |
| Client          | Own case and document uploads only                                                         |

---

## Test Logins

All accounts are seeded on the live deployment.

| Role                     | Email                | Password       |
| ------------------------ | -------------------- | -------------- |
| Platform Admin           | admin@leadflow.test  | ChangeMe123!   |
| Brokerage Admin (Muster) | admin@muster.test    | ChangeMe123!   |
| Advisor (Muster)         | advisor@muster.test  | ChangeMe123!   |
| Advisor (Hausbau)        | advisor@hausbau.test | ChangeMe123!   |
| Client (Muster)          | client@muster.test   | ClientDemo123! |

Hausbau is a second brokerage for checking tenant isolation. The backend runs on Render's free tier, so the first request after idle can take about 30 seconds.

---

## Deployment

| Part      | Platform      | URL                                       |
| --------- | ------------- | ----------------------------------------- |
| Frontend  | Vercel        | https://leadflow-one-opal.vercel.app/     |
| Backend   | Render        | https://leadflow-rbdt.onrender.com/health |
| Database  | MongoDB Atlas | Private                                   |
| Redis     | Upstash       | Private                                   |
| Documents | Cloudinary    | Private                                   |
| Email     | Resend        | External service                          |

Backend health check:

```text
https://leadflow-rbdt.onrender.com/health
```

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/sahil78tt/leadflow
cd leadflow
```

### 2. Install backend dependencies

```bash
cd server
npm install
```

Create `.env` and add the required environment variables.

### 3. Seed the database

```bash
npm run seed
```

### 4. Start the backend

```bash
npm run dev
```

### 5. Install frontend dependencies

Open another terminal:

```bash
cd client
npm install
```

Create the frontend `.env` file and start the client:

```bash
npm run dev
```

---

## Environment Variables

### Server

```env
//Database
MONGODB_URI=your_mongo_url
MONGODB_URI_TEST=your_mongo_test_url

//JWT
JWT_SECRET=your_jwt_secret

//Ports
CLIENT_URL=http://localhost:5173
PORT=4000

//Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

//Redis Configuration
UPSTASH_REDIS_URL=your_upstash_redis_url

//Resend Configuration
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM=

//Webhook Secret
WEBHOOK_SECRET=your_webhook_secret

//Seed
SEED_PASSWORD=your_seed_password
```

### Client

```env
VITE_API_URL=http://localhost:4000
```

Never commit real secrets to the repository.

---

## Testing

The backend has targeted tests for the main workflows and security-sensitive areas (tenant isolation, duplicate/idempotent ingestion, concurrent stage moves, documents, automations).

Run the full backend suite:

```bash
cd server
npm test
```

Tests for the email and task automation work:

```text
Email Templates    7
Email Triggers     7
Task Triggers      7
Tasks API          8
Task Automation    5
---------------------
Total             34
Passed            34
Failed             0
```

Backend build:

```bash
cd server
npm run build
```

Frontend build:

```bash
cd client
npm run build
```

Both builds pass.

---

## Security

- JWT authentication
- bcrypt password hashing
- Role-based authorization
- Brokerage-level tenant isolation
- Fail-closed tenant context
- MongoDB unique constraints
- Idempotent lead webhook
- Atomic lead stage updates
- MongoDB transaction for lead conversion
- Private Cloudinary documents
- Signed document URLs
- Brokerage-scoped Socket.IO events
- Client-specific document events

---

## Known Limitations

This was built as a 5–7 day assignment, so some production-level features are intentionally simplified.

- Handling 500 leads in one minute has not been load-tested.
- There is no per-brokerage rate limiting, so one brokerage flooding the system could affect others.
- Background processing runs in the application process rather than a durable job queue; document checks recover on restart but have no retries or dead-letter handling.
- Failed emails are recorded but not retried.
- Production Resend email delivery requires a verified sender domain, which is not set up.
- The lead webhook has no authentication beyond the brokerage ID (no per-brokerage secret or HMAC signing).
- Live events missed while a client is offline are not replayed; the board refetches on reconnect.
- Only one task trigger is supported per brokerage and stage.
- Document checking is simulated instead of using a real document verification service.
- Socket.IO uses the in-memory adapter, so horizontal scaling would require a Redis adapter.
- JWTs are stateless, so user deactivation does not immediately invalidate an already-issued token.
- Client password reset/change flow is not fully implemented.
- Platform admin UI is limited.
- There is no dedicated reminder/notification system for overdue tasks.
- Frontend E2E tests are not currently implemented.

These are the main areas I would address next for a production version.

---

## AI Usage

Claude was used during development. All prompts are logged in order and unedited in [`PROMPTS.md`](./PROMPTS.md). A two-paragraph project summary is in [`SUMMARY.md`](./SUMMARY.md).

---

## Assignment Coverage

| Requirement             | Implementation                                |
| ----------------------- | --------------------------------------------- |
| Multi-brokerage support | Brokerage-scoped tenant isolation             |
| External lead source    | Google Forms + Apps Script webhook            |
| Live pipeline           | React + Socket.IO                             |
| Duplicate detection     | Normalization + unique indexes + idempotency  |
| Lead → client           | MongoDB transaction + client portal           |
| Document workflow       | Cloudinary + simulated background checks      |
| Fast dashboard          | Upstash Redis + cache invalidation            |
| Email templates         | Brokerage admin CRUD + placeholders           |
| Email triggers          | Pipeline stage → configured template → Resend |
| Task triggers           | Pipeline stage → advisor task + due date      |
| Overdue tasks           | Calculated by API + highlighted in UI         |

---

<p align="center">
  LeadFlow — MERN Developer Assignment
</p>
