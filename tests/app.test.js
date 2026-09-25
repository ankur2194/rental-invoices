import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, getProfile } from "../server/db.js";
import { buildApp } from "../server/app.js";
import { getInvoice, runSchedules } from "../server/billing.js";
import { processEmailJobs } from "../server/email.js";

async function fixture(t, { mailer = null } = {}) {
  const db = openDatabase(":memory:");
  const app = await buildApp({
    db,
    logger: false,
    worker: false,
    testing: true,
    mailer,
    config: {
      adminEmail: "admin@example.com",
      adminPassword: "local-test-password",
      appOrigin: "http://localhost:3000",
      secureCookie: false,
    },
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { "x-requested-with": "rental-portal" },
    payload: { email: "admin@example.com", password: "local-test-password" },
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = login.headers["set-cookie"].split(";")[0];
  const call = (url, method = "GET", payload) =>
    app.inject({
      url,
      method,
      payload,
      headers: {
        cookie,
        "x-requested-with": "rental-portal",
        origin: "http://localhost:3000",
      },
    });
  const profile = {
    ...getProfile(db),
    name: "Test Landlord",
    email: "landlord@example.com",
    address: "Vadodara",
    payment_details: "UPI: test@example",
  };
  assert.equal((await call("/api/profile", "PUT", profile)).statusCode, 200);
  const property = (
    await call("/api/properties", "POST", {
      name: "Garden House",
      address: "Tarsali, Vadodara",
      unit: "First floor",
    })
  ).json();
  const tenant = (
    await call("/api/tenants", "POST", {
      name: "Test Tenant",
      property_id: property.id,
      email: "tenant@example.com",
      rent: "12000",
      lease_start: "2024-01-01",
    })
  ).json();
  const input = {
    tenant_id: tenant.id,
    issue_date: "2026-01-01",
    due_date: "2026-01-07",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    items: [
      {
        title: "Rent {month} {year}",
        description: "{property}",
        quantity: "1",
        rate: "12000",
        category: "Rent",
      },
      {
        title: "Electricity",
        quantity: "50",
        rate: "8.25",
        category: "Electricity",
      },
    ],
    notes: "Thank you",
    auto_email: false,
  };
  return { app, db, call, profile, property, tenant, input };
}
test("authenticated invoice workflow, snapshot, PDF, partial payments, void and optional email", async (t) => {
  const { app, db, call, input, profile } = await fixture(t);
  assert.equal((await app.inject("/api/invoices")).statusCode, 401);
  assert.equal((await app.inject("/api/invoices/1/pdf")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/login",
        payload: {
          email: "admin@example.com",
          password: "local-test-password",
        },
      })
    ).statusCode,
    403,
  );
  const created = await call("/api/invoices", "POST", input);
  assert.equal(created.statusCode, 200, created.body);
  const inv = created.json();
  assert.equal(inv.total_cents, 1241250);
  assert.equal(inv.items[0].title, "Rent January 2026");
  assert.equal(inv.email_jobs.length, 0);
  assert.match(inv.number, /^INV-2026-00001$/);
  await call("/api/profile", "PUT", {
    ...profile,
    name: "Renamed Landlord",
    currency: "USD",
  });
  assert.equal(
    (await call(`/api/invoices/${inv.id}`)).json().snapshot.landlord.name,
    "Test Landlord",
  );
  const pdf = await call(`/api/invoices/${inv.id}/pdf`);
  assert.equal(pdf.statusCode, 200);
  assert.match(pdf.headers["content-disposition"], /attachment/);
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.rawPayload.length > 1000);
  assert.equal(
    (
      await call(`/api/invoices/${inv.id}/payments`, "POST", {
        amount: "20000",
        date: "2026-01-02",
      })
    ).statusCode,
    400,
  );
  const pay = await call(`/api/invoices/${inv.id}/payments`, "POST", {
    amount: "4000",
    date: "2026-01-02",
    reference: "Bank transfer",
  });
  assert.equal(pay.statusCode, 200);
  assert.equal(
    (await call(`/api/invoices/${inv.id}`)).json().balance_cents,
    841250,
  );
  assert.equal(
    (await call(`/api/invoices/${inv.id}/void`, "POST", {})).statusCode,
    400,
  );
  assert.equal(
    (await call(`/api/invoices/${inv.id}/email`, "POST", {})).statusCode,
    400,
  );
  const totals = (await call("/api/dashboard")).json().totals;
  assert.equal(totals[0].currency, "INR");
  assert.equal(totals[0].collected, 400000);
  await call(`/api/payments/${pay.json().id}`, "DELETE");
  assert.equal(
    (await call(`/api/invoices/${inv.id}/void`, "POST", {})).statusCode,
    200,
  );
  assert.equal(
    (
      await call(`/api/invoices/${inv.id}/payments`, "POST", {
        amount: "1",
        date: "2026-01-02",
      })
    ).statusCode,
    400,
  );
  assert.equal((await call("/api/invoices?status=void")).json().total, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_jobs").get().n, 0);
});
test("validation and request origin protections", async (t) => {
  const { app, call, input } = await fixture(t);
  assert.equal(
    (await call("/api/invoices", "POST", { ...input, due_date: "2025-12-01" }))
      .statusCode,
    400,
  );
  assert.equal(
    (await call("/api/invoices", "POST", { ...input, tenant_id: 999 }))
      .statusCode,
    404,
  );
  assert.equal(
    (await call("/api/invoices", "POST", { ...input, auto_email: true }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await call("/api/invoices", "POST", {
        ...input,
        items: [{ ...input.items[0], title: "{bad_token}" }],
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/login",
        headers: {
          origin: "https://evil.example",
          "x-requested-with": "rental-portal",
        },
        payload: {
          email: "admin@example.com",
          password: "local-test-password",
        },
      })
    ).statusCode,
    403,
  );
  const res = await call("/api/invoices");
  assert.match(
    res.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  assert.equal(res.headers["cache-control"], "no-store");
});
test("schedule catches up, deduplicates across restarts, preserves month-end and stops after lease", async (t) => {
  const { db, call, input, tenant } = await fixture(t);
  const result = await call("/api/rules", "POST", {
    tenant_id: tenant.id,
    name: "Rent",
    frequency: "monthly",
    anchor_date: "2026-01-31",
    next_date: "2026-01-31",
    end_date: "2026-04-30",
    due_days: 7,
    items: input.items,
    auto_email: false,
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(runSchedules(db, "2026-03-31").created, 3);
  assert.equal(runSchedules(db, "2026-03-31").created, 0);
  assert.deepEqual(
    db
      .prepare("SELECT issue_date FROM invoices ORDER BY id")
      .all()
      .map((i) => i.issue_date),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.equal(
    db.prepare("SELECT next_date FROM rules").get().next_date,
    "2026-04-30",
  );
  // Simulate crash between invoice commit and cursor update.
  db.prepare("UPDATE rules SET next_date='2026-03-31'").run();
  assert.equal(runSchedules(db, "2026-03-31").created, 0);
  db.prepare("UPDATE tenants SET lease_end='2026-04-01'").run();
  assert.equal(runSchedules(db, "2026-05-31").created, 0);
  assert.equal(db.prepare("SELECT active FROM rules").get().active, 0);
});
test("archived properties suspend schedules and surface the reason", async (t) => {
  const { db, call, input, tenant } = await fixture(t);
  await call("/api/rules", "POST", {
    tenant_id: tenant.id,
    name: "Rent",
    frequency: "weekly",
    anchor_date: "2026-01-01",
    next_date: "2026-01-01",
    due_days: 7,
    items: input.items,
  });
  db.prepare("UPDATE properties SET active=0").run();
  assert.equal(runSchedules(db, "2026-01-02").created, 0);
  assert.match(
    db.prepare("SELECT last_error FROM rules").get().last_error,
    /archived/,
  );
});
test("email attachments are optional, pending requests deduplicate, failures retry and void cancels", async (t) => {
  const sent = [];
  let fail = false;
  const mailer = {
    from: "Billing <billing@example.com>",
    transport: {
      sendMail: async (message) => {
        if (fail) throw new Error("SMTP unavailable");
        sent.push(message);
      },
    },
  };
  const { db, call, input } = await fixture(t, { mailer });
  const inv = (
    await call("/api/invoices", "POST", { ...input, auto_email: true })
  ).json();
  assert.equal(inv.email_jobs.length, 1);
  await call(`/api/invoices/${inv.id}/email`, "POST", {});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_jobs").get().n, 1);
  await processEmailJobs(db, mailer);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "tenant@example.com");
  assert.equal(
    sent[0].attachments[0].content.subarray(0, 5).toString(),
    "%PDF-",
  );
  assert.equal(getInvoice(db, inv.id).email_jobs[0].status, "sent");
  fail = true;
  await call(`/api/invoices/${inv.id}/email`, "POST", {});
  await processEmailJobs(db, mailer);
  const job = getInvoice(db, inv.id).email_jobs[0];
  assert.equal(job.status, "pending");
  assert.equal(job.attempts, 1);
  assert.match(job.error, /SMTP unavailable/);
  await call(`/api/invoices/${inv.id}/void`, "POST", {});
  assert.equal(getInvoice(db, inv.id).email_jobs[0].status, "cancelled");
});
test("password change revokes existing sessions", async (t) => {
  const { call } = await fixture(t);
  assert.equal(
    (
      await call("/api/password", "POST", {
        current: "wrong",
        password: "a-new-long-password",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call("/api/password", "POST", {
        current: "local-test-password",
        password: "a-new-long-password",
      })
    ).statusCode,
    200,
  );
  assert.equal((await call("/api/me")).statusCode, 401);
});
