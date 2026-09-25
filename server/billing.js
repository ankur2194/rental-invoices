import { getProfile, transaction } from "./db.js";
import {
  AppError,
  calculateItems,
  renderTemplate,
  nextOccurrence,
  periodFor,
  addDays,
  todayIn,
} from "./domain.js";

export function tenantContext(db, id) {
  const tenant = db.prepare("SELECT * FROM tenants WHERE id=?").get(id);
  if (!tenant) throw new AppError("Tenant not found", 404);
  const property = db
    .prepare("SELECT * FROM properties WHERE id=?")
    .get(tenant.property_id);
  return { tenant, property };
}
export function queueEmail(db, invoiceId, recipientOverride) {
  const invoice = getInvoice(db, invoiceId);
  if (invoice.status === "void")
    throw new AppError("Void invoices cannot be emailed");
  const recipient = recipientOverride ?? invoice.snapshot.tenant.email;
  if (!recipient)
    throw new AppError(
      "This invoice has no tenant email. Add an email before creating a new invoice.",
    );
  const existing = db
    .prepare(
      "SELECT id FROM email_jobs WHERE invoice_id=? AND recipient=? COLLATE NOCASE AND status IN ('pending','sending')",
    )
    .get(invoiceId, recipient);
  if (existing) return existing.id;
  return Number(
    db
      .prepare("INSERT INTO email_jobs(invoice_id,recipient) VALUES(?,?)")
      .run(invoiceId, recipient).lastInsertRowid,
  );
}
export function createInvoice(
  db,
  input,
  { ruleId = null, occurrence = null } = {},
) {
  return transaction(db, () =>
    createInvoiceRecord(db, input, { ruleId, occurrence }),
  );
}
function createInvoiceRecord(
  db,
  input,
  { ruleId = null, occurrence = null, recreatedFromId = null } = {},
) {
  if (ruleId) {
    const existing = db
      .prepare("SELECT id FROM invoices WHERE rule_id=? AND occurrence=?")
      .get(ruleId, occurrence);
    if (existing) return getInvoice(db, existing.id);
  }
  const { tenant, property } = tenantContext(db, input.tenant_id);
  const profile = getProfile(db, property.landlord_id);
  if (!profile?.name)
    throw new AppError(
      "Complete this landlord profile before creating invoices",
    );
  if (!tenant.active || !property.active)
    throw new AppError("Tenant and property must be active");
  if (input.auto_email && !tenant.email)
    throw new AppError("Add a tenant email or disable email delivery");
  const context = {
    period_start: input.period_start,
    period_end: input.period_end,
    issue_date: input.issue_date,
    tenant: tenant.name,
    property: property.name,
    unit: property.unit,
  };
  const calculated = calculateItems(
    input.items.map((item) => ({
      ...item,
      title: renderTemplate(item.title, context),
      description: renderTemplate(item.description || "", context),
    })),
  );
  const notes = renderTemplate(input.notes || "", context);
  const snapshot = JSON.stringify({ landlord: profile, tenant, property });
  const id = Number(
    db
      .prepare(
        "INSERT INTO invoices(landlord_id,tenant_id,rule_id,occurrence,issue_date,due_date,period_start,period_end,snapshot,items,notes,total_cents,recreated_from_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        profile.id,
        tenant.id,
        ruleId,
        occurrence,
        input.issue_date,
        input.due_date,
        input.period_start,
        input.period_end,
        snapshot,
        JSON.stringify(calculated.items),
        notes,
        calculated.total_cents,
        recreatedFromId,
      ).lastInsertRowid,
  );
  const number = `${profile.prefix}-${input.issue_date.slice(0, 4)}-${String(id).padStart(5, "0")}`;
  db.prepare("UPDATE invoices SET number=? WHERE id=?").run(number, id);
  if (input.auto_email) queueEmail(db, id);
  return getInvoice(db, id);
}
export function recreateInvoice(db, invoiceId) {
  return transaction(db, () => {
    const original = getInvoice(db, invoiceId);
    const existing = db
      .prepare(
        "SELECT id FROM invoices WHERE recreated_from_id=? ORDER BY id DESC LIMIT 1",
      )
      .get(original.id);
    if (existing) return getInvoice(db, existing.id);
    if (original.paid_cents)
      throw new AppError(
        "Remove recorded payments before recreating this invoice",
      );
    if (original.email_jobs.some((job) => job.status === "sending"))
      throw new AppError(
        "Email delivery is in progress. Try again after it completes.",
      );
    if (original.status !== "void") {
      db.prepare("UPDATE invoices SET status='void' WHERE id=?").run(
        original.id,
      );
      db.prepare(
        "UPDATE email_jobs SET status='cancelled',error='Invoice replaced' WHERE invoice_id=? AND status IN ('pending','failed','uncertain')",
      ).run(original.id);
    }
    return createInvoiceRecord(
      db,
      {
        tenant_id: original.tenant_id,
        issue_date: original.issue_date,
        due_date: original.due_date,
        period_start: original.period_start,
        period_end: original.period_end,
        items: original.items.map((item) => ({
          title: item.title,
          description: item.description || "",
          category: item.category,
          quantity: item.quantity,
          rate: (item.rate_cents / 100).toFixed(2),
        })),
        notes: original.notes,
        auto_email: false,
      },
      { recreatedFromId: original.id },
    );
  });
}
export function getInvoice(db, id) {
  const row = db.prepare("SELECT * FROM invoices WHERE id=?").get(id);
  if (!row) throw new AppError("Invoice not found", 404);
  const payments = db
    .prepare(
      "SELECT * FROM payments WHERE invoice_id=? ORDER BY date DESC,id DESC",
    )
    .all(id);
  const paid_cents = payments.reduce((total, p) => total + p.amount_cents, 0);
  const replacement = db
    .prepare(
      "SELECT id,number FROM invoices WHERE recreated_from_id=? ORDER BY id DESC LIMIT 1",
    )
    .get(id);
  const source = row.recreated_from_id
    ? db
        .prepare("SELECT id,number FROM invoices WHERE id=?")
        .get(row.recreated_from_id)
    : null;
  return {
    ...row,
    snapshot: JSON.parse(row.snapshot),
    items: JSON.parse(row.items),
    payments,
    paid_cents,
    balance_cents: row.total_cents - paid_cents,
    replacement: replacement || null,
    recreated_from: source || null,
    email_jobs: db
      .prepare("SELECT * FROM email_jobs WHERE invoice_id=? ORDER BY id DESC")
      .all(id),
  };
}
export function listInvoices(
  db,
  { search = "", status = "", page = 1, landlordId = getProfile(db).id } = {},
) {
  const rows = db
    .prepare(
      `SELECT i.id,i.number,i.issue_date,i.due_date,i.total_cents,i.status,json_extract(i.snapshot,'$.tenant.name') tenant_name,json_extract(i.snapshot,'$.property.name') property_name,json_extract(i.snapshot,'$.landlord.currency') currency,COALESCE((SELECT SUM(amount_cents) FROM payments WHERE invoice_id=i.id),0) paid_cents,(SELECT status FROM email_jobs WHERE invoice_id=i.id ORDER BY id DESC LIMIT 1) email_status FROM invoices i WHERE i.landlord_id=? ORDER BY i.id DESC`,
    )
    .all(landlordId);
  const today = todayIn(getProfile(db, landlordId).timezone);
  const mapped = rows.map((i) => ({
    ...i,
    balance_cents: i.total_cents - i.paid_cents,
    display_status:
      i.status === "void"
        ? "void"
        : i.paid_cents >= i.total_cents
          ? "paid"
          : i.due_date < today
            ? "overdue"
            : i.paid_cents > 0
              ? "partial"
              : "unpaid",
  }));
  const filtered = mapped.filter(
    (i) =>
      (!status || i.display_status === status) &&
      `${i.number} ${i.tenant_name} ${i.property_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return {
    items: filtered.slice((page - 1) * 50, page * 50),
    total: filtered.length,
    page,
  };
}
export function runSchedules(db, today, landlordId) {
  const rules = db
    .prepare(
      `SELECT r.*,p.landlord_id FROM rules r
       JOIN tenants t ON t.id=r.tenant_id
       JOIN properties p ON p.id=t.property_id
       WHERE r.active=1 AND (? IS NULL OR p.landlord_id=?)
       ORDER BY r.next_date,r.id LIMIT 100`,
    )
    .all(landlordId ?? null, landlordId ?? null);
  let created = 0;
  for (const rule of rules) {
    try {
      const { tenant, property } = tenantContext(db, rule.tenant_id);
      const ruleToday =
        today || todayIn(getProfile(db, property.landlord_id).timezone);
      if (rule.next_date > ruleToday) continue;
      if (!tenant.active || !property.active) {
        db.prepare(
          "UPDATE rules SET last_error='Tenant or property is archived; schedule skipped' WHERE id=?",
        ).run(rule.id);
        continue;
      }
      let occurrence = rule.next_date;
      for (let i = 0; i < 24 && occurrence <= ruleToday; i++) {
        if (
          (rule.end_date && occurrence > rule.end_date) ||
          (tenant.lease_end && occurrence > tenant.lease_end)
        ) {
          db.prepare("UPDATE rules SET active=0,last_error='' WHERE id=?").run(
            rule.id,
          );
          break;
        }
        if (tenant.lease_start && occurrence < tenant.lease_start)
          throw new AppError("Schedule begins before the lease starts");
        const period = periodFor(occurrence, rule.frequency, rule.anchor_date);
        const already = db
          .prepare("SELECT id FROM invoices WHERE rule_id=? AND occurrence=?")
          .get(rule.id, occurrence);
        createInvoice(
          db,
          {
            tenant_id: rule.tenant_id,
            issue_date: occurrence,
            due_date: addDays(occurrence, rule.due_days),
            ...period,
            items: JSON.parse(rule.items),
            notes: rule.notes,
            auto_email: !!rule.auto_email,
          },
          { ruleId: rule.id, occurrence },
        );
        if (!already) created++;
        occurrence = nextOccurrence(
          occurrence,
          rule.frequency,
          rule.anchor_date,
        );
        db.prepare("UPDATE rules SET next_date=?,last_error='' WHERE id=?").run(
          occurrence,
          rule.id,
        );
      }
    } catch (error) {
      db.prepare("UPDATE rules SET last_error=? WHERE id=?").run(
        String(error.message).slice(0, 500),
        rule.id,
      );
    }
  }
  return { created };
}
