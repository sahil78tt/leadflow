// Post-deploy smoke test.  Usage:  npm run smoke -- https://your-api.onrender.com
// Needs the seeded users (src/scripts/seed.ts). SEED_PASSWORD must match the one used when seeding.

const base = (process.argv[2] ?? process.env.SMOKE_API ?? "").replace(
  /\/$/,
  "",
);
const password = process.env.SEED_PASSWORD ?? "ChangeMe123!";

if (!base) {
  console.error("Usage: npm run smoke -- <api base url>");
  process.exit(1);
}

interface Reply<T> {
  status: number;
  headers: Headers;
  body: T;
}

async function call<T>(
  path: string,
  init: { method?: string; token?: string; json?: unknown } = {},
): Promise<Reply<T>> {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.json !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(90_000), // the first request after a Render cold start can take about a minute
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, headers: res.headers, body };
}

let failures = 0;
async function step(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? ` (${detail})` : ""}`);
  } catch (err) {
    failures += 1;
    console.error(
      `FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface LoginBody {
  token: string;
  user: { brokerageId: string | null };
}
interface LeadDto {
  id: string;
  name: string;
  stage: string;
  version: number;
}
interface DashboardBody {
  counts: Record<string, number>;
  total: number;
}

async function login(email: string) {
  const r = await call<LoginBody>("/api/auth/login", {
    method: "POST",
    json: { email, password },
  });
  expect(r.status === 200, `login ${email} returned ${r.status}`);
  return r.body;
}

const stamp = `Smoke test ${new Date().toISOString()}`;
let tokenA = "";
let brokerageA = "";
let tokenB = "";
let lead: LeadDto | undefined;

await step("API is up (GET /health)", async () => {
  const r = await call<{ ok?: boolean }>("/health");
  expect(r.status === 200 && r.body.ok === true, `returned ${r.status}`);
});

await step("login: advisor of brokerage A", async () => {
  const session = await login("advisor@muster.test");
  expect(session.user.brokerageId, "token has no brokerage");
  tokenA = session.token;
  brokerageA = session.user.brokerageId;
});

await step("login: advisor of brokerage B", async () => {
  tokenB = (await login("advisor@hausbau.test")).token;
});

await step("unauthenticated board request is refused", async () => {
  const r = await call("/api/leads");
  expect(r.status === 401, `returned ${r.status}`);
});

await step("webhook accepts a lead (202)", async () => {
  // Phone only, on purpose: no email means no welcome email is ever triggered by a smoke run.
  const phone = `+49151${Math.floor(10_000_000 + Math.random() * 90_000_000)}`;
  const r = await call(`/api/leads/webhook/${brokerageA}`, {
    method: "POST",
    json: { name: stamp, phone },
  });
  expect(r.status === 202, `returned ${r.status}`);
});

await step("the new lead is on brokerage A's board", async () => {
  const r = await call<{ leads: LeadDto[] }>("/api/leads", { token: tokenA });
  expect(r.status === 200, `returned ${r.status}`);
  lead = r.body.leads.find((l) => l.name === stamp);
  expect(lead, "lead not found on the board");
});

await step("stage move bumps the version", async () => {
  expect(lead, "no lead from the previous step");
  const r = await call<{ lead: LeadDto }>(`/api/leads/${lead.id}/stage`, {
    method: "PATCH",
    token: tokenA,
    json: { stage: "contacted", version: lead.version },
  });
  expect(r.status === 200, `returned ${r.status}`);
  expect(r.body.lead.version === lead.version + 1, "version did not increase");
});

await step("tenant isolation: brokerage B cannot move or see it", async () => {
  expect(lead, "no lead from an earlier step");
  const move = await call(`/api/leads/${lead.id}/stage`, {
    method: "PATCH",
    token: tokenB,
    json: { stage: "won", version: 1 },
  });
  expect(
    move.status === 404,
    `cross-tenant move returned ${move.status} (expected 404)`,
  );
  const list = await call<{ leads: LeadDto[] }>("/api/leads", {
    token: tokenB,
  });
  expect(
    !list.body.leads.some((l) => l.name === stamp),
    "B's board contains A's lead",
  );
});

await step("dashboard counts include the lead", async () => {
  const first = await call<DashboardBody>("/api/dashboard", { token: tokenA });
  const second = await call<DashboardBody>("/api/dashboard", { token: tokenA });
  expect(first.status === 200, `returned ${first.status}`);
  expect(
    first.body.counts.contacted >= 1,
    "contacted count is missing the lead",
  );
  return `cache: ${first.headers.get("x-cache")} then ${second.headers.get("x-cache")}`;
});

console.log(
  failures === 0
    ? "\nAll smoke checks passed."
    : `\n${failures} smoke check(s) failed.`,
);
console.log(
  `Note: the lead "${stamp}" stays in brokerage A's board (stage: Contacted).`,
);
process.exit(failures === 0 ? 0 : 1);
