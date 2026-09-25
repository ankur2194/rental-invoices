import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import serveStatic from "@fastify/static";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase, getProfile, listProfiles, transaction } from "./db.js";
import { bootstrap, registerAuth } from "./auth.js";
import {
  AppError,
  profileSchema,
  propertySchema,
  tenantSchema,
  ruleSchema,
  invoiceSchema,
  cents,
  date,
  calculateItems,
  renderTemplate,
  todayIn,
} from "./domain.js";
import {
  tenantContext,
  createInvoice,
  getInvoice,
  listInvoices,
  queueEmail,
  runSchedules,
} from "./billing.js";
import { makePdf } from "./pdf.js";
import { createMailer, processEmailJobs } from "./email.js";

export async function buildApp(options = {}) {
  const config = {
    appOrigin: process.env.APP_URL || "http://localhost:3000",
    secureCookie: process.env.COOKIE_SECURE === "true",
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    ...options.config,
  };
  config.appOrigin = new URL(config.appOrigin).origin;
  if (
    process.env.NODE_ENV === "production" &&
    !config.secureCookie &&
    !options.testing
  )
    throw new Error(
      "Production requires COOKIE_SECURE=true and HTTPS through your reverse proxy",
    );
  const db = options.db || openDatabase();
  await bootstrap(db, config);
  const mailer = options.mailer === undefined ? createMailer() : options.mailer;
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 128 * 1024,
    trustProxy: process.env.TRUST_PROXY || false,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.secureCookie ? [] : null,
      },
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
  });
  await registerAuth(app, db, config);
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: error.issues
          .map((i) => `${i.path.join(".") || "Input"}: ${i.message}`)
          .join("; "),
      });
    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({ error: error.message });
    req.log.error(error);
    reply
      .code(500)
      .send({ error: "An unexpected error occurred. Check the server logs." });
  });
  const id = (req) => z.coerce.number().int().positive().parse(req.params.id);
  const requireSmtp = () => {
    if (!mailer)
      throw new AppError(
        "Configure SMTP in your environment before enabling email",
      );
  };
  const requireRecord = (table, recordId) => {
    if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(recordId))
      throw new AppError("Record not found", 404);
  };
  const selectedLandlord = (req) => {
    const profileId = z.coerce
      .number()
      .int()
      .positive()
      .parse(req.query?.landlord_id ?? getProfile(db)?.id);
    if (!getProfile(db, profileId))
      throw new AppError("Landlord profile not found", 404);
    return profileId;
  };
  app.get("/health", async () => ({
    ok: !!db.prepare("SELECT 1 healthy").get().healthy,
  }));
  app.get("/api/profiles", async () => listProfiles(db));
  app.post("/api/profiles", async (req) => {
    const profile = profileSchema.parse(req.body);
    const profileId = Number(
      db
        .prepare("INSERT INTO landlord_profiles(data) VALUES(?)")
        .run(JSON.stringify(profile)).lastInsertRowid,
    );
    return getProfile(db, profileId);
  });
  app.put("/api/profiles/:id", async (req) => {
    const profileId = id(req);
    if (!getProfile(db, profileId))
      throw new AppError("Landlord profile not found", 404);
    const profile = profileSchema.parse(req.body);
    db.prepare("UPDATE landlord_profiles SET data=? WHERE id=?").run(
      JSON.stringify(profile),
      profileId,
    );
    return getProfile(db, profileId);
  });
  // Compatibility aliases for clients deployed before multi-profile support.
  app.get("/api/profile", async () => getProfile(db));
  app.put("/api/profile", async (req) => {
    const profile = profileSchema.parse(req.body);
    const profileId = getProfile(db).id;
    db.prepare("UPDATE landlord_profiles SET data=? WHERE id=?").run(
      JSON.stringify(profile),
      profileId,
    );
    return getProfile(db, profileId);
  });
  app.get("/api/system", async (req) => ({
    email_configured: !!mailer,
    today: todayIn(getProfile(db, selectedLandlord(req)).timezone),
  }));
  app.get("/api/properties", async (req) =>
    db
      .prepare(
        "SELECT * FROM properties WHERE landlord_id=? ORDER BY active DESC,name",
      )
      .all(selectedLandlord(req)),
  );
  const saveProperty = (req, update) => {
    const p = propertySchema.parse(req.body);
    if (update) {
      requireRecord("properties", id(req));
      db.prepare(
        "UPDATE properties SET name=?,address=?,unit=?,notes=?,active=? WHERE id=?",
      ).run(p.name, p.address, p.unit, p.notes, +p.active, id(req));
      return { id: id(req) };
    }
    return {
      id: Number(
        db
          .prepare(
            "INSERT INTO properties(landlord_id,name,address,unit,notes,active) VALUES(?,?,?,?,?,?)",
          )
          .run(
            selectedLandlord(req),
            p.name,
            p.address,
            p.unit,
            p.notes,
            +p.active,
          ).lastInsertRowid,
      ),
    };
  };
  app.post("/api/properties", async (req) => saveProperty(req, false));
  app.put("/api/properties/:id", async (req) => saveProperty(req, true));
  app.get("/api/tenants", async (req) =>
    db
      .prepare(
        "SELECT t.*,p.name property_name,p.unit FROM tenants t JOIN properties p ON p.id=t.property_id WHERE p.landlord_id=? ORDER BY t.active DESC,t.name",
      )
      .all(selectedLandlord(req)),
  );
  const saveTenant = (req, update) => {
    const t = tenantSchema.parse(req.body);
    requireRecord("properties", t.property_id);
    const args = [
      t.property_id,
      t.name,
      t.email,
      t.phone,
      t.address,
      t.tax_id,
      cents(t.rent),
      cents(t.deposit),
      t.lease_start,
      t.lease_end,
      t.notes,
      +t.active,
    ];
    if (update) {
      requireRecord("tenants", id(req));
      db.prepare(
        "UPDATE tenants SET property_id=?,name=?,email=?,phone=?,address=?,tax_id=?,rent_cents=?,deposit_cents=?,lease_start=?,lease_end=?,notes=?,active=? WHERE id=?",
      ).run(...args, id(req));
      return { id: id(req) };
    }
    return {
      id: Number(
        db
          .prepare(
            "INSERT INTO tenants(property_id,name,email,phone,address,tax_id,rent_cents,deposit_cents,lease_start,lease_end,notes,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(...args).lastInsertRowid,
      ),
    };
  };
  app.post("/api/tenants", async (req) => saveTenant(req, false));
  app.put("/api/tenants/:id", async (req) => saveTenant(req, true));
  app.get("/api/invoices", async (req) => {
    const q = z
      .object({
        search: z.string().max(200).default(""),
        status: z
          .enum(["", "unpaid", "paid", "partial", "overdue", "void"])
          .default(""),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        landlord_id: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const landlordId = q.landlord_id ?? getProfile(db).id;
    if (!getProfile(db, landlordId))
      throw new AppError("Landlord profile not found", 404);
    return listInvoices(db, { ...q, landlordId });
  });
  app.post("/api/invoices", async (req) => {
    const input = invoiceSchema.parse(req.body);
    if (input.auto_email) requireSmtp();
    return createInvoice(db, input);
  });
  app.get("/api/invoices/:id", async (req) => getInvoice(db, id(req)));
  app.get("/api/invoices/:id/pdf", async (req, reply) => {
    const inv = getInvoice(db, id(req));
    return reply
      .type("application/pdf")
      .header("Content-Disposition", `attachment; filename="${inv.number}.pdf"`)
      .send(await makePdf(inv));
  });
  app.post("/api/invoices/:id/email", async (req) => {
    requireSmtp();
    const { recipient } = z
      .object({
        recipient: z.string().trim().max(254).email().optional(),
      })
      .strict()
      .parse(req.body ?? {});
    return { id: queueEmail(db, id(req), recipient) };
  });
  app.post("/api/invoices/:id/void", async (req) =>
    transaction(db, () => {
      const inv = getInvoice(db, id(req));
      if (inv.paid_cents)
        throw new AppError(
          "Remove recorded payments before voiding this invoice",
        );
      if (inv.email_jobs.some((j) => j.status === "sending"))
        throw new AppError(
          "Email delivery is in progress. Try again after it completes.",
        );
      db.prepare("UPDATE invoices SET status='void' WHERE id=?").run(inv.id);
      db.prepare(
        "UPDATE email_jobs SET status='cancelled',error='Invoice voided' WHERE invoice_id=? AND status IN ('pending','failed','uncertain')",
      ).run(inv.id);
      return { ok: true };
    }),
  );
  app.post("/api/invoices/:id/payments", async (req) =>
    transaction(db, () => {
      const p = z
        .object({
          amount: z.union([z.string(), z.number()]),
          date,
          reference: z.string().trim().max(200).default(""),
        })
        .parse(req.body);
      const inv = getInvoice(db, id(req));
      const amount = cents(p.amount);
      if (inv.status === "void" || amount <= 0 || amount > inv.balance_cents)
        throw new AppError(
          "Payment must be positive and cannot exceed the outstanding balance",
        );
      return {
        id: Number(
          db
            .prepare(
              "INSERT INTO payments(invoice_id,amount_cents,date,reference) VALUES(?,?,?,?)",
            )
            .run(inv.id, amount, p.date, p.reference).lastInsertRowid,
        ),
      };
    }),
  );
  app.delete("/api/payments/:id", async (req) => {
    requireRecord("payments", id(req));
    db.prepare("DELETE FROM payments WHERE id=?").run(id(req));
    return { ok: true };
  });
  app.get("/api/rules", async (req) =>
    db
      .prepare(
        "SELECT r.*,t.name tenant_name,p.name property_name FROM rules r JOIN tenants t ON t.id=r.tenant_id JOIN properties p ON p.id=t.property_id WHERE p.landlord_id=? ORDER BY r.active DESC,r.next_date",
      )
      .all(selectedLandlord(req))
      .map((r) => ({ ...r, items: JSON.parse(r.items) })),
  );
  const saveRule = (req, update) => {
    const r = ruleSchema.parse(req.body);
    const { tenant } = tenantContext(db, r.tenant_id);
    if (r.auto_email) {
      requireSmtp();
      if (!tenant.email) throw new AppError("Tenant needs an email address");
    }
    calculateItems(r.items);
    const ctx = {
      period_start: r.next_date,
      period_end: r.next_date,
      issue_date: r.next_date,
      tenant: tenant.name,
      property: "Property",
      unit: "Unit",
    };
    for (const item of r.items) {
      renderTemplate(item.title, ctx);
      renderTemplate(item.description, ctx);
    }
    renderTemplate(r.notes, ctx);
    const args = [
      r.tenant_id,
      r.name,
      r.frequency,
      r.anchor_date,
      r.next_date,
      r.end_date,
      r.due_days,
      JSON.stringify(r.items),
      r.notes,
      +r.auto_email,
      +r.active,
    ];
    if (update) {
      requireRecord("rules", id(req));
      db.prepare(
        "UPDATE rules SET tenant_id=?,name=?,frequency=?,anchor_date=?,next_date=?,end_date=?,due_days=?,items=?,notes=?,auto_email=?,active=?,last_error='' WHERE id=?",
      ).run(...args, id(req));
      return { id: id(req) };
    }
    return {
      id: Number(
        db
          .prepare(
            "INSERT INTO rules(tenant_id,name,frequency,anchor_date,next_date,end_date,due_days,items,notes,auto_email,active) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(...args).lastInsertRowid,
      ),
    };
  };
  app.post("/api/rules", async (req) => saveRule(req, false));
  app.put("/api/rules/:id", async (req) => saveRule(req, true));
  app.post("/api/rules/run", async (req) =>
    runSchedules(db, undefined, selectedLandlord(req)),
  );
  app.get("/api/emails", async (req) =>
    db
      .prepare(
        "SELECT e.*,i.number FROM email_jobs e JOIN invoices i ON i.id=e.invoice_id WHERE i.landlord_id=? ORDER BY e.id DESC LIMIT 100",
      )
      .all(selectedLandlord(req)),
  );
  app.post("/api/emails/:id/retry", async (req) => {
    requireSmtp();
    const job = db.prepare("SELECT * FROM email_jobs WHERE id=?").get(id(req));
    if (!job) throw new AppError("Email job not found", 404);
    if (!["failed", "uncertain"].includes(job.status))
      throw new AppError("Only failed or uncertain deliveries can be retried");
    if (getInvoice(db, job.invoice_id).status === "void")
      throw new AppError("Cannot email a void invoice");
    if (
      db
        .prepare(
          "SELECT id FROM email_jobs WHERE invoice_id=? AND status IN ('pending','sending')",
        )
        .get(job.invoice_id)
    )
      throw new AppError("A delivery for this invoice is already queued");
    db.prepare(
      "UPDATE email_jobs SET status='pending',attempts=0,next_attempt=0,error='' WHERE id=?",
    ).run(job.id);
    return { ok: true };
  });
  app.get("/api/dashboard", async (req) => {
    const landlordId = selectedLandlord(req);
    const profile = getProfile(db, landlordId);
    const totals = db
      .prepare(
        `SELECT json_extract(i.snapshot,'$.landlord.currency') currency,SUM(i.total_cents) billed,SUM(COALESCE(p.paid,0)) collected,SUM(i.total_cents-COALESCE(p.paid,0)) outstanding,SUM(CASE WHEN i.due_date<? THEN i.total_cents-COALESCE(p.paid,0) ELSE 0 END) overdue FROM invoices i LEFT JOIN (SELECT invoice_id,SUM(amount_cents) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id=i.id WHERE i.status!='void' AND i.landlord_id=? GROUP BY currency`,
      )
      .all(todayIn(profile.timezone), landlordId);
    return {
      totals,
      tenants: db
        .prepare(
          "SELECT COUNT(*) n FROM tenants t JOIN properties p ON p.id=t.property_id WHERE t.active=1 AND p.landlord_id=?",
        )
        .get(landlordId).n,
      properties: db
        .prepare(
          "SELECT COUNT(*) n FROM properties WHERE active=1 AND landlord_id=?",
        )
        .get(landlordId).n,
      active_rules: db
        .prepare(
          "SELECT COUNT(*) n FROM rules r JOIN tenants t ON t.id=r.tenant_id JOIN properties p ON p.id=t.property_id WHERE r.active=1 AND p.landlord_id=?",
        )
        .get(landlordId).n,
      failed_emails: db
        .prepare(
          "SELECT COUNT(*) n FROM email_jobs e JOIN invoices i ON i.id=e.invoice_id WHERE e.status IN ('failed','uncertain') AND i.landlord_id=?",
        )
        .get(landlordId).n,
      rule_errors: db
        .prepare(
          "SELECT COUNT(*) n FROM rules r JOIN tenants t ON t.id=r.tenant_id JOIN properties p ON p.id=t.property_id WHERE r.active=1 AND r.last_error!='' AND p.landlord_id=?",
        )
        .get(landlordId).n,
      recent: listInvoices(db, { landlordId }).items.slice(0, 6),
    };
  });
  const root = resolve("dist");
  if (existsSync(root))
    await app.register(serveStatic, { root, prefix: "/", index: "index.html" });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: "Not found" }),
  );
  // Do not blindly resend a message that might have reached SMTP before a crash.
  db.prepare(
    "UPDATE email_jobs SET status='uncertain',error='Server restarted during delivery; verify recipient before retrying' WHERE status='sending'",
  ).run();
  let running = false,
    timer;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      runSchedules(db);
      await processEmailJobs(db, mailer, app.log);
      db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    } catch (e) {
      app.log.error(e);
    } finally {
      running = false;
    }
  };
  if (options.worker !== false) {
    timer = setInterval(tick, 60000);
    timer.unref();
    app.addHook("onReady", tick);
  }
  app.addHook("onClose", async () => {
    clearInterval(timer);
    while (running) await new Promise((r) => setTimeout(r, 20));
    if (!options.db) db.close();
  });
  app.decorate("db", db);
  return app;
}
