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
  { ruleId = null, occurrence = null } = {},
) {
  if (ruleId) {
    const existing = db
      .prepare("SELECT id FROM invoices WHERE rule_id=? AND occurrence=?")
      .get(ruleId, occurrence);
    if (existing) return getInvoice(db, existing.id);
  }
  const prepared = prepareInvoice(db, input);
  const sequence = db
    .prepare(
      `INSERT INTO landlord_invoice_sequences(landlord_id,next_value) VALUES(?,2)
       ON CONFLICT(landlord_id) DO UPDATE SET next_value=next_value+1
       RETURNING next_value-1 value`,
    )
    .get(prepared.profile.id).value;
  const number = `${prepared.profile.prefix}-${input.issue_date.slice(0, 4)}-${String(sequence).padStart(5, "0")}`;
  const id = Number(
    db
      .prepare(
        "INSERT INTO invoices(landlord_id,tenant_id,rule_id,occurrence,issue_date,due_date,period_start,period_end,snapshot,items,notes,total_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        prepared.profile.id,
        prepared.tenant.id,
        ruleId,
        occurrence,
        input.issue_date,
        input.due_date,
        input.period_start,
        input.period_end,
        prepared.snapshot,
        JSON.stringify(prepared.calculated.items),
        prepared.notes,
        prepared.calculated.total_cents,
      ).lastInsertRowid,
  );
  db.prepare("UPDATE invoices SET number=? WHERE id=?").run(number, id);
  if (input.auto_email) queueEmail(db, id);
  return getInvoice(db, id);
}
function prepareInvoice(db, input) {
  const { tenant, property } = tenantContext(db, input.tenant_id);
  const profile = getProfile(db, property.landlord_id);
  if (!profile?.name)
    throw new AppError(
      "Complete this landlord profile before creating invoices",
    );
  if (
    db
      .prepare(
        "SELECT id FROM landlord_profiles WHERE id!=? AND json_extract(data,'$.prefix')=? LIMIT 1",
      )
      .get(profile.id, profile.prefix) ||
    db
      .prepare(
        "SELECT id FROM invoices WHERE landlord_id!=? AND number GLOB ? LIMIT 1",
      )
      .get(profile.id, `${profile.prefix}-[0-9][0-9][0-9][0-9]-*`)
  )
    throw new AppError(
      "Each landlord profile must use a unique invoice prefix",
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
  return { tenant, property, profile, calculated, notes, snapshot };
}
export function updateInvoice(db, invoiceId, input) {
  return transaction(db, () => {
    const invoice = getInvoice(db, invoiceId);
    if (invoice.status === "void")
      throw new AppError("Void invoices cannot be edited");
    if (invoice.email_jobs.some((job) => job.status === "sending"))
      throw new AppError(
        "Email delivery is in progress. Edit the invoice after it completes.",
      );
    const prepared = prepareInvoice(db, input);
    if (prepared.profile.id !== invoice.landlord_id)
      throw new AppError(
        "An invoice cannot be moved to a different landlord profile",
      );
    if (prepared.calculated.total_cents < invoice.paid_cents)
      throw new AppError(
        "Invoice total cannot be lower than its recorded payments",
      );
    db.prepare(
      `UPDATE invoices SET landlord_id=?,tenant_id=?,issue_date=?,due_date=?,period_start=?,period_end=?,snapshot=?,items=?,notes=?,total_cents=? WHERE id=?`,
    ).run(
      prepared.profile.id,
      prepared.tenant.id,
      input.issue_date,
      input.due_date,
      input.period_start,
      input.period_end,
      prepared.snapshot,
      JSON.stringify(prepared.calculated.items),
      prepared.notes,
      prepared.calculated.total_cents,
      invoice.id,
    );
    return getInvoice(db, invoice.id);
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
  return {
    ...row,
    snapshot: JSON.parse(row.snapshot),
    items: JSON.parse(row.items),
    payments,
    paid_cents,
    balance_cents: row.total_cents - paid_cents,
    email_jobs: db
      .prepare("SELECT * FROM email_jobs WHERE invoice_id=? ORDER BY id DESC")
      .all(id),
  };
}
export function listInvoices(
  db,
  {
    search = "",
    status = "",
    page = 1,
    landlordId = getProfile(db).id,
    pageSize = 50,
  } = {},
) {
  const today = todayIn(getProfile(db, landlordId).timezone);
  const escapedSearch = search.toLowerCase().replace(/[\\%_]/g, "\\$&");
  const rows = db
    .prepare(
      `WITH invoice_rows AS (
        SELECT i.id,i.number,i.issue_date,i.due_date,i.total_cents,i.status,
          json_extract(i.snapshot,'$.tenant.name') tenant_name,
          json_extract(i.snapshot,'$.property.name') property_name,
          json_extract(i.snapshot,'$.landlord.currency') currency,
          COALESCE((SELECT SUM(amount_cents) FROM payments WHERE invoice_id=i.id),0) paid_cents,
          (SELECT status FROM email_jobs WHERE invoice_id=i.id ORDER BY id DESC LIMIT 1) email_status
        FROM invoices i WHERE i.landlord_id=?
      ), classified AS (
        SELECT *,total_cents-paid_cents balance_cents,
          CASE
            WHEN status='void' THEN 'void'
            WHEN paid_cents>=total_cents THEN 'paid'
            WHEN due_date<? THEN 'overdue'
            WHEN paid_cents>0 THEN 'partial'
            ELSE 'unpaid'
          END display_status
        FROM invoice_rows
        WHERE LOWER(COALESCE(number,'') || ' ' || COALESCE(tenant_name,'') || ' ' || COALESCE(property_name,'')) LIKE ? ESCAPE '\\'
      )
      SELECT *,COUNT(*) OVER() filtered_total FROM classified
      WHERE (?='' OR display_status=?)
      ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(
      landlordId,
      today,
      `%${escapedSearch}%`,
      status,
      status,
      pageSize,
      (page - 1) * pageSize,
    );
  const total = rows[0]?.filtered_total || 0;
  for (const row of rows) delete row.filtered_total;
  return {
    items: rows,
    total,
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
