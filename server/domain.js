import { z } from "zod";

export class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
const short = z.string().trim().max(200);
const long = z.string().trim().max(2000);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return (
      !Number.isNaN(d.getTime()) &&
      d.toISOString().slice(0, 10) === s &&
      s >= "2000-01-01" &&
      s <= "2199-12-31"
    );
  }, "Use a valid date between 2000 and 2199");
const optionalDate = z.union([z.literal(""), date]);
const email = z.union([z.literal(""), z.email().max(254)]);
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (value) =>
      !value || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value),
    "Use a valid 15-character GSTIN",
  );
const pan = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (value) => !value || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value),
    "Use a valid 10-character PAN",
  );
const stateCode = z
  .string()
  .trim()
  .refine(
    (value) => !value || /^\d{2}$/.test(value),
    "Use a 2-digit state code",
  );
const money = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (s) => /^\d{1,9}(\.\d{1,2})?$/.test(s),
    "Use a nonnegative amount with at most two decimal places",
  );
export function cents(amount) {
  const s = money.parse(amount);
  const [whole, fraction = ""] = s.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
const itemSchema = z.object({
  title: short.min(1),
  description: long.default(""),
  category: z
    .enum([
      "Rent",
      "Electricity",
      "Maintenance",
      "Corporation tax", // Legacy saved schedules and invoices remain compatible.
      "Municipal Property Tax",
      "Water",
      "Other",
    ])
    .default("Rent")
    .transform((value) =>
      value === "Corporation tax" ? "Municipal Property Tax" : value,
    ),
  quantity: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine(
      (s) => /^\d{1,5}(\.\d{1,3})?$/.test(s) && Number(s) > 0,
      "Quantity must be positive with at most three decimal places",
    ),
  rate: money,
  sac_code: z
    .string()
    .trim()
    .refine(
      (value) => !value || /^\d{4,8}$/.test(value),
      "SAC/HSN must contain 4 to 8 digits",
    )
    .default(""),
  unit: z.string().trim().max(10).default("NOS"),
  gst_rate: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine(
      (value) =>
        /^\d{1,2}(\.\d{1,3})?$|^100(?:\.0{1,3})?$/.test(value) &&
        Number(value) <= 100,
      "GST rate must be between 0 and 100 with up to three decimals",
    )
    .default("0"),
});
const itemsSchema = z.array(itemSchema).min(1).max(30);
export const profileSchema = z
  .object({
    name: short.min(1),
    email,
    phone: short,
    address: long,
    tax_id: short.default(""), // Retained for older deployed clients.
    pan: pan.default(""),
    gstin: gstin.default(""),
    state: short.default(""),
    state_code: stateCode.default(""),
    payment_details: long,
    notes: long,
    currency: z.enum([
      "INR",
      "USD",
      "GBP",
      "EUR",
      "AUD",
      "CAD",
      "SGD",
      "CHF",
      "AED",
    ]),
    timezone: z
      .string()
      .max(100)
      .refine((s) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: s });
          return true;
        } catch {
          return false;
        }
      }, "Invalid time zone"),
    prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z0-9/-]{1,6}$/,
        "Use 1-6 uppercase letters, numbers, hyphens or slashes",
      ),
  })
  .superRefine((profile, ctx) => {
    if (
      profile.gstin &&
      profile.pan &&
      profile.gstin.slice(2, 12) !== profile.pan
    )
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "GSTIN must contain the same PAN",
      });
    if (
      profile.gstin &&
      profile.state_code &&
      profile.gstin.slice(0, 2) !== profile.state_code
    )
      ctx.addIssue({
        code: "custom",
        path: ["state_code"],
        message: "State code must match the first two GSTIN digits",
      });
  });
export const propertySchema = z.object({
  name: short.min(1),
  address: long.min(1),
  unit: short.default(""),
  state: short.default(""),
  state_code: stateCode.default(""),
  notes: long.default(""),
  active: z.boolean().default(true),
});
export const tenantSchema = z
  .object({
    property_id: z.coerce.number().int().positive(),
    name: short.min(1),
    email: email.default(""),
    phone: short.default(""),
    address: long.default(""),
    tax_id: short.default(""),
    gstin: gstin.default(""),
    state: short.default(""),
    state_code: stateCode.default(""),
    rent: money.default("0"),
    deposit: money.default("0"),
    lease_start: optionalDate.default(""),
    lease_end: optionalDate.default(""),
    notes: long.default(""),
    active: z.boolean().default(true),
  })
  .refine(
    (x) => !x.lease_start || !x.lease_end || x.lease_end >= x.lease_start,
    "Lease end must be after its start",
  )
  .superRefine((tenant, ctx) => {
    if (
      tenant.gstin &&
      tenant.state_code &&
      tenant.gstin.slice(0, 2) !== tenant.state_code
    )
      ctx.addIssue({
        code: "custom",
        path: ["state_code"],
        message: "State code must match the first two GSTIN digits",
      });
  });
export const invoiceSchema = z
  .object({
    tenant_id: z.coerce.number().int().positive(),
    issue_date: date,
    due_date: date,
    period_start: date,
    period_end: date,
    items: itemsSchema,
    document_type: z
      .enum(["invoice", "tax_invoice", "bill_of_supply"])
      .default("invoice"),
    tax_mode: z.enum(["none", "cgst_sgst", "igst"]).default("none"),
    reverse_charge: z.boolean().default(false),
    notes: long.default(""),
    auto_email: z.boolean().default(false),
  })
  .refine(
    (x) => x.due_date >= x.issue_date && x.period_end >= x.period_start,
    "Due date / period end must not precede their start",
  )
  .refine(
    (x) => x.document_type !== "invoice" || !x.reverse_charge,
    "Reverse charge is only available on GST documents",
  );
export const ruleSchema = z
  .object({
    tenant_id: z.coerce.number().int().positive(),
    name: short.min(1),
    frequency: z.enum(["weekly", "monthly", "yearly"]),
    anchor_date: date,
    next_date: date,
    end_date: optionalDate.default(""),
    due_days: z.coerce.number().int().min(0).max(365),
    items: itemsSchema,
    document_type: z
      .enum(["invoice", "tax_invoice", "bill_of_supply"])
      .default("invoice"),
    tax_mode: z.enum(["none", "cgst_sgst", "igst"]).default("none"),
    reverse_charge: z.boolean().default(false),
    notes: long.default(""),
    auto_email: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine(
    (x) =>
      x.next_date >= x.anchor_date &&
      (!x.end_date || x.end_date >= x.next_date),
    "Next date must follow start and precede end",
  )
  .refine(
    (x) => x.document_type !== "invoice" || !x.reverse_charge,
    "Reverse charge is only available on GST documents",
  );
export function calculateItems(items, taxMode = "none") {
  let taxable = 0,
    cgst = 0,
    sgst = 0,
    igst = 0;
  const result = itemsSchema.parse(items).map((item) => {
    const rate_cents = cents(item.rate);
    const [whole, fraction = ""] = item.quantity.split(".");
    const quantity_milli =
      Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
    const product = rate_cents * quantity_milli;
    if (!Number.isSafeInteger(product))
      throw new AppError("Item amount is too large");
    const amount_cents = Math.round(product / 1000);
    const gstRateMilli = Math.round(Number(item.gst_rate) * 1000);
    const halfTax = Math.round((amount_cents * gstRateMilli) / 200000);
    const fullTax = Math.round((amount_cents * gstRateMilli) / 100000);
    const cgst_cents = taxMode === "cgst_sgst" ? halfTax : 0;
    const sgst_cents = taxMode === "cgst_sgst" ? halfTax : 0;
    const igst_cents = taxMode === "igst" ? fullTax : 0;
    const tax_cents = cgst_cents + sgst_cents + igst_cents;
    taxable += amount_cents;
    cgst += cgst_cents;
    sgst += sgst_cents;
    igst += igst_cents;
    return {
      ...item,
      rate_cents,
      amount_cents,
      cgst_cents,
      sgst_cents,
      igst_cents,
      tax_cents,
      gross_cents: amount_cents + tax_cents,
    };
  });
  const total = taxable + cgst + sgst + igst;
  if (total <= 0 || total > 99999999999)
    throw new AppError("Invoice total must be positive and below 1 billion");
  return {
    items: result,
    taxable_cents: taxable,
    cgst_cents: cgst,
    sgst_cents: sgst,
    igst_cents: igst,
    tax_cents: cgst + sgst + igst,
    total_cents: total,
  };
}
export function financialYearCode(value) {
  const [year, month] = value.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}
export function todayIn(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export const addDays = (date, days) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
export function nextOccurrence(current, frequency, anchor) {
  if (frequency === "weekly") return addDays(current, 7);
  const [y, m] = current.split("-").map(Number);
  const [, am, ad] = anchor.split("-").map(Number);
  const target =
    frequency === "monthly"
      ? new Date(Date.UTC(y, m, 1))
      : new Date(Date.UTC(y + 1, am - 1, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(ad, last));
  return target.toISOString().slice(0, 10);
}
export function periodFor(start, frequency, anchor) {
  return {
    period_start: start,
    period_end: addDays(nextOccurrence(start, frequency, anchor), -1),
  };
}
export function renderTemplate(text, context) {
  const d = new Date(context.period_start + "T00:00:00Z");
  const values = {
    ...context,
    month: new Intl.DateTimeFormat("en", {
      month: "long",
      timeZone: "UTC",
    }).format(d),
    year: String(d.getUTCFullYear()),
    month_number: String(d.getUTCMonth() + 1).padStart(2, "0"),
    date: context.issue_date,
  };
  return text.replace(/\{([a-z_]+)\}/g, (match, key) => {
    if (!Object.hasOwn(values, key))
      throw new AppError(`Unknown template token: ${match}`);
    return values[key];
  });
}
