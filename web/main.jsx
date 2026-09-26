import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import "./style.css";

const categories = [
  "Rent",
  "Electricity",
  "Maintenance",
  "Municipal Property Tax",
  "Water",
  "Other",
];
const freshItem = () => ({
  title: "Rent for {month} {year}",
  description: "{property} · {period_start} to {period_end}",
  category: "Rent",
  quantity: "1",
  rate: "0",
});
const currencyOptions = [
  "INR",
  "USD",
  "GBP",
  "EUR",
  "AUD",
  "CAD",
  "SGD",
  "CHF",
  "AED",
];
const blankProfile = () => ({
  name: "",
  email: "",
  phone: "",
  address: "",
  tax_id: "",
  payment_details: "",
  notes: "",
  currency: "INR",
  timezone: "Asia/Kolkata",
  prefix: "INV",
});
const appPages = new Set([
  "dashboard",
  "invoices",
  "tenants",
  "properties",
  "automations",
  "email",
  "profile",
]);
function readRoute() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "invoices" && /^\d+$/.test(parts[1] || ""))
    return {
      page: "invoices",
      invoiceId: Number(parts[1]),
      path: `/invoices/${parts[1]}`,
    };
  const page = appPages.has(parts[0]) ? parts[0] : "dashboard";
  return { page, invoiceId: null, path: `/${page}` };
}
function setRoute(path, replace = false) {
  if (window.location.pathname === path) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
}
const paths = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  invoices: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6 M9 15h3",
  tenants:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  properties:
    "M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-5h6v5 M9 8h1 M14 8h1 M9 12h1 M14 12h1",
  automations:
    "M20 7h-9a5 5 0 0 0-5 5v1 M16 3l4 4-4 4 M4 17h9a5 5 0 0 0 5-5v-1 M8 21l-4-4 4-4",
  profile:
    "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2",
  email: "M3 5h18v14H3z M3 5l9 7 9-7",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  logout: "M9 3H4v18h5 M10 12h11 M17 8l4 4-4 4",
  check: "M5 12l4 4L19 6",
  close: "M6 6l12 12 M18 6L6 18",
  search: "M21 21l-6-6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  clock: "M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  menu: "M3 6h18 M3 12h18 M3 18h18",
};
function Icon({ name, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.invoices} />
    </svg>
  );
}
const money = (value, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format((value || 0) / 100);
const dateLabel = (value) =>
  value
    ? new Date(value + "T00:00:00Z").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";
async function api(path, method = "GET", body) {
  const res = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "rental-portal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data.error || "Request failed");
    e.status = res.status;
    if (res.status === 401 && path !== "/login")
      window.dispatchEvent(new Event("session-expired"));
    throw e;
  }
  return data;
}
function Button({ children, secondary = false, icon, ...props }) {
  return (
    <button class={secondary ? "btn secondary" : "btn"} {...props}>
      {icon && <Icon name={icon} size={17} />} {children}
    </button>
  );
}
function Field({ label, children, hint, wide = false, ...props }) {
  const uid = useRef(`f-${Math.random().toString(36).slice(2)}`);
  return (
    <div class={"field " + (wide ? "wide" : "")}>
      <label for={uid.current}>{label}</label>
      {children ? children : <input id={uid.current} {...props} />}{" "}
      {hint && <small>{hint}</small>}
    </div>
  );
}
function Select({ label, value, onChange, children, wide = false }) {
  return (
    <label class={"field " + (wide ? "wide" : "")}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
function TextArea({ label, value, onChange, wide = true, ...props }) {
  return (
    <label class={"field " + (wide ? "wide" : "")}>
      <span>{label}</span>
      <textarea
        value={value}
        onInput={(e) => onChange(e.target.value)}
        rows="3"
        {...props}
      />
    </label>
  );
}
function Check({ label, checked, onChange, disabled = false }) {
  return (
    <label class="check wide">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
function Badge({ status }) {
  return (
    <span class={"badge " + status}>
      {status?.replace("_", " ") || "unpaid"}
    </span>
  );
}
function Empty({ icon = "invoices", title, description, action }) {
  return (
    <div class="empty">
      <span class="empty-icon">
        <Icon name={icon} size={27} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Modal({ title, subtitle, children, onClose, large = false }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      class={large ? "modal large" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div class="modal-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button class="icon-btn" onClick={onClose} aria-label="Close dialog">
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ErrorBox({ error }) {
  return error ? (
    <div class="error" role="alert">
      {error}
    </div>
  ) : null;
}
function FormShell({ children, onSubmit, onClose, label = "Save changes" }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div class="form-body">
        <ErrorBox error={error} />
        {children}
      </div>
      <footer class="form-footer">
        <Button type="button" secondary onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} type="submit">
          {busy ? "Saving…" : label}
        </Button>
      </footer>
    </form>
  );
}
function Login({ onLogin }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main class="login">
      <section class="login-story">
        <div class="brand">
          <span class="brand-icon">
            <Icon name="properties" size={24} />
          </span>
          rentfolio<span class="brand-dot">.</span>
        </div>
        <span class="eyebrow">LESS ADMIN. MORE PEACE OF MIND.</span>
        <h1>
          Your properties.
          <br />
          Your invoices.
          <br />
          <em>All in order.</em>
        </h1>
        <p>
          A simpler home for your rental finances, from the first invoice to the
          last payment.
        </p>
        <div class="login-points">
          <span>
            <Icon name="check" /> Organized billing
          </span>
          <span>
            <Icon name="check" /> Effortless recurring invoices
          </span>
        </div>
        <small>RENTAL MANAGEMENT, SIMPLIFIED</small>
      </section>
      <section class="login-form">
        <div>
          <span class="eyebrow">YOUR PRIVATE WORKSPACE</span>
          <h2>Welcome back</h2>
          <p>Sign in to manage your properties and billing.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/login", "POST", { email, password });
                onLogin();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ErrorBox error={error} />
            <Field
              label="Email address"
              type="email"
              autoComplete="username"
              required
              value={email}
              onInput={(e) => setEmail(e.target.value)}
            />
            <Field
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onInput={(e) => setPassword(e.target.value)}
            />
            <Button disabled={busy} type="submit" icon="arrow">
              {busy ? "Signing in…" : "Sign in to your workspace"}
            </Button>
          </form>
          <small>
            Use the administrator account configured for this portal.
          </small>
        </div>
      </section>
    </main>
  );
}
function InvoiceTable({ items, onOpen, currency }) {
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Invoice / Tenant</th>
            <th>Property</th>
            <th>Due date</th>
            <th>Amount</th>
            <th>Status</th>
            <th>
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <button class="text-link" onClick={() => onOpen(i.id)}>
                  {i.number}
                </button>
                <small>{i.tenant_name}</small>
              </td>
              <td>{i.property_name}</td>
              <td>{dateLabel(i.due_date)}</td>
              <td class="amount">
                {money(i.total_cents, i.currency || currency)}
              </td>
              <td>
                <Badge status={i.display_status} />
              </td>
              <td>
                <a
                  class="icon-btn"
                  href={`/api/invoices/${i.id}/pdf`}
                  aria-label={`Download ${i.number} PDF`}
                >
                  <Icon name="download" size={18} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ItemsEditor({ items, onChange, currency }) {
  const update = (i, k, v) =>
    onChange(items.map((x, index) => (index === i ? { ...x, [k]: v } : x)));
  const total = items.reduce(
    (sum, i) =>
      sum + Math.round(Number(i.quantity || 0) * Number(i.rate || 0) * 100),
    0,
  );
  return (
    <section class="items-editor wide">
      <div class="section-label">
        <h3>Invoice items</h3>
        <button
          type="button"
          class="text-link"
          onClick={() => onChange([...items, freshItem()])}
          disabled={items.length >= 30}
        >
          + Add item
        </button>
      </div>
      {items.map((item, i) => (
        <div class="item-edit" key={i}>
          <div class="item-number">{String(i + 1).padStart(2, "0")}</div>
          <div class="form-grid">
            <Field
              label="Item title"
              value={item.title}
              required
              maxLength="200"
              onInput={(e) => update(i, "title", e.target.value)}
            />
            <Select
              label="Category"
              value={
                item.category === "Corporation tax"
                  ? "Municipal Property Tax"
                  : item.category
              }
              onChange={(v) => update(i, "category", v)}
            >
              {categories.map((c) => (
                <option>{c}</option>
              ))}
            </Select>
            <Field
              label="Description"
              wide
              value={item.description}
              maxLength="2000"
              onInput={(e) => update(i, "description", e.target.value)}
            />
            <Field
              label="Quantity"
              type="number"
              step="0.001"
              min="0.001"
              max="99999"
              required
              value={item.quantity}
              onInput={(e) => update(i, "quantity", e.target.value)}
            />
            <Field
              label={`Rate (${currency})`}
              type="number"
              step="0.01"
              min="0"
              required
              value={item.rate}
              onInput={(e) => update(i, "rate", e.target.value)}
            />
          </div>
          <button
            type="button"
            class="icon-btn danger"
            aria-label={`Remove item ${i + 1}`}
            disabled={items.length === 1}
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      <div class="item-total">
        <span>Invoice total</span>
        <strong>{money(total, currency)}</strong>
      </div>
      <details>
        <summary>Use dynamic dates and tenant details</summary>
        <p>
          Titles, descriptions and notes accept <code>{"{month}"}</code>,{" "}
          <code>{"{year}"}</code>, <code>{"{month_number}"}</code>,{" "}
          <code>{"{date}"}</code>, <code>{"{period_start}"}</code>,{" "}
          <code>{"{period_end}"}</code>, <code>{"{tenant}"}</code>,{" "}
          <code>{"{property}"}</code> and <code>{"{unit}"}</code>. Month and
          year use the billing period start. Date ranges use YYYY-MM-DD.
        </p>
        <p>
          Example: <b>{"Maintenance for {month} {year}"}</b>
        </p>
      </details>
    </section>
  );
}
function RecordEditor({ kind, record, properties, onClose, onSave, currency }) {
  const defaults =
    kind === "property"
      ? { name: "", address: "", unit: "", notes: "", active: true }
      : {
          name: "",
          property_id: properties.find((p) => p.active)?.id || "",
          email: "",
          phone: "",
          address: "",
          tax_id: "",
          rent: "0",
          deposit: "0",
          lease_start: "",
          lease_end: "",
          notes: "",
          active: true,
        };
  const [data, setData] = useState(
    record
      ? {
          ...record,
          active: !!record.active,
          rent: ((record.rent_cents || 0) / 100).toFixed(2),
          deposit: ((record.deposit_cents || 0) / 100).toFixed(2),
        }
      : defaults,
  );
  const set = (k, v) => setData((current) => ({ ...current, [k]: v }));
  return (
    <Modal
      title={`${record ? "Edit" : "Add"} ${kind}`}
      subtitle={
        kind === "tenant"
          ? "Keep your tenant, lease and billing details together."
          : "Add the property and unit you invoice for."
      }
      onClose={onClose}
    >
      <FormShell onClose={onClose} onSubmit={() => onSave(data)}>
        <div class="form-grid">
          <Field
            label={
              kind === "property" ? "Property name" : "Tenant / company name"
            }
            required
            value={data.name}
            onInput={(e) => set("name", e.target.value)}
            wide
          />
          {kind === "property" ? (
            <>
              <Field
                label="Unit / floor"
                value={data.unit}
                onInput={(e) => set("unit", e.target.value)}
                wide
              />
              <TextArea
                label="Property address"
                required
                value={data.address}
                onChange={(v) => set("address", v)}
              />
            </>
          ) : (
            <>
              <Select
                label="Property"
                value={data.property_id}
                onChange={(v) => set("property_id", v)}
                wide
              >
                <option value="">Select a property</option>
                {properties.map((p) => (
                  <option value={p.id}>
                    {p.name}
                    {p.unit ? " / " + p.unit : ""}
                    {p.active ? "" : " (archived)"}
                  </option>
                ))}
              </Select>
              <Field
                label="Email (optional)"
                type="email"
                value={data.email}
                onInput={(e) => set("email", e.target.value)}
              />
              <Field
                label="Phone"
                value={data.phone}
                onInput={(e) => set("phone", e.target.value)}
              />
              <TextArea
                label="Billing address"
                value={data.address}
                onChange={(v) => set("address", v)}
              />
              <Field
                label="Tax ID / GSTIN (optional)"
                wide
                value={data.tax_id}
                onInput={(e) => set("tax_id", e.target.value)}
              />
              <Field
                label={`Default rent (${currency})`}
                type="number"
                min="0"
                step="0.01"
                required
                value={data.rent}
                onInput={(e) => set("rent", e.target.value)}
              />
              <Field
                label={`Security deposit (${currency})`}
                type="number"
                min="0"
                step="0.01"
                required
                value={data.deposit}
                onInput={(e) => set("deposit", e.target.value)}
              />
              <Field
                label="Lease start"
                type="date"
                value={data.lease_start}
                onInput={(e) => set("lease_start", e.target.value)}
              />
              <Field
                label="Lease end (optional)"
                type="date"
                value={data.lease_end}
                onInput={(e) => set("lease_end", e.target.value)}
              />
            </>
          )}
          <TextArea
            label="Internal notes"
            value={data.notes}
            onChange={(v) => set("notes", v)}
          />
          <Check
            label={`Active ${kind} (uncheck to archive)`}
            checked={data.active}
            onChange={(v) => set("active", v)}
          />
        </div>
      </FormShell>
    </Modal>
  );
}
function BillingEditor({
  rule = false,
  record,
  tenants,
  profile,
  system,
  onClose,
  onSave,
}) {
  const today = system.today;
  const first = tenants.find((t) => t.active);
  const [data, setData] = useState(
    record
      ? {
          ...record,
          items:
            !rule && record.items
              ? record.items.map((item) => ({
                  ...item,
                  rate: (item.rate_cents / 100).toFixed(2),
                }))
              : record.items,
          active: !!record.active,
          auto_email: !!record.auto_email,
        }
      : {
          tenant_id: first?.id || "",
          issue_date: today,
          due_date: today,
          period_start: today,
          period_end: today,
          items: [
            {
              ...freshItem(),
              rate: ((first?.rent_cents || 0) / 100).toFixed(2),
            },
          ],
          notes: "",
          auto_email: false,
          name: "Monthly rent",
          frequency: "monthly",
          anchor_date: today,
          next_date: today,
          end_date: "",
          due_days: 7,
          active: true,
        },
  );
  const set = (k, v) => setData((old) => ({ ...old, [k]: v }));
  return (
    <Modal
      large
      title={
        rule
          ? record
            ? "Edit recurring schedule"
            : "Create recurring schedule"
          : record
            ? `Edit ${record.number}`
            : "Create an invoice"
      }
      subtitle={
        rule
          ? "Set it once. We’ll create invoices when they’re due."
          : record
            ? "Update this invoice and refresh its saved contact and property details."
            : "Rent, utilities, maintenance and other property charges."
      }
      onClose={onClose}
    >
      <FormShell
        onClose={onClose}
        label={
          rule ? "Save schedule" : record ? "Update invoice" : "Create invoice"
        }
        onSubmit={() => onSave(data)}
      >
        <div class="form-grid">
          <Select
            wide
            label="Tenant & property"
            value={data.tenant_id}
            onChange={(v) => {
              const t = tenants.find((t) => t.id === Number(v));
              setData({
                ...data,
                tenant_id: v,
                items:
                  data.items.length === 1 && data.items[0].category === "Rent"
                    ? [
                        {
                          ...data.items[0],
                          rate: ((t?.rent_cents || 0) / 100).toFixed(2),
                        },
                      ]
                    : data.items,
              });
            }}
          >
            <option value="">Select a tenant</option>
            {tenants
              .filter((t) => t.active || t.id === Number(data.tenant_id))
              .map((t) => (
                <option value={t.id}>
                  {t.name} · {t.property_name}
                </option>
              ))}
          </Select>
          {rule ? (
            <>
              <Field
                label="Schedule name"
                required
                value={data.name}
                onInput={(e) => set("name", e.target.value)}
              />
              <Select
                label="Frequency"
                value={data.frequency}
                onChange={(v) => set("frequency", v)}
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="yearly">Yearly</option>
              </Select>
              <Field
                label="Schedule anchor / first date"
                type="date"
                required
                value={data.anchor_date}
                hint="The anchor preserves your preferred day, including month-end."
                onInput={(e) =>
                  setData({
                    ...data,
                    anchor_date: e.target.value,
                    ...(!record ? { next_date: e.target.value } : {}),
                  })
                }
              />
              <Field
                label="Next invoice date"
                type="date"
                required
                value={data.next_date}
                onInput={(e) => set("next_date", e.target.value)}
              />
              <Field
                label="Stop after (optional)"
                type="date"
                value={data.end_date}
                onInput={(e) => set("end_date", e.target.value)}
              />
              <Field
                label="Payment due after (days)"
                type="number"
                min="0"
                max="365"
                required
                value={data.due_days}
                onInput={(e) => set("due_days", e.target.value)}
              />
              <div class="notice wide">
                Billing periods run from each occurrence to the day before the
                next. Past dates are caught up automatically. Amounts are not
                prorated.
              </div>
            </>
          ) : (
            <>
              <Field
                label="Issue date"
                type="date"
                required
                value={data.issue_date}
                onInput={(e) => set("issue_date", e.target.value)}
              />
              <Field
                label="Due date"
                type="date"
                required
                value={data.due_date}
                onInput={(e) => set("due_date", e.target.value)}
              />
              <Field
                label="Billing period start"
                type="date"
                required
                value={data.period_start}
                onInput={(e) => set("period_start", e.target.value)}
              />
              <Field
                label="Billing period end"
                type="date"
                required
                value={data.period_end}
                onInput={(e) => set("period_end", e.target.value)}
              />
            </>
          )}
          <ItemsEditor
            items={data.items}
            onChange={(v) => set("items", v)}
            currency={profile.currency}
          />
          <TextArea
            label="Invoice notes"
            value={data.notes}
            onChange={(v) => set("notes", v)}
          />
          {!rule && record && (
            <div class="notice wide">
              Saving keeps the invoice number, payments and email history, and
              refreshes landlord, tenant and property details from their current
              records.
            </div>
          )}
          {(rule || !record) && (
            <Check
              label="Email the PDF to the tenant automatically (optional)"
              checked={data.auto_email}
              onChange={(v) => set("auto_email", v)}
              disabled={!system.email_configured}
            />
          )}
          {(rule || !record) && !system.email_configured && (
            <small class="muted wide">
              Email is disabled until SMTP is configured. PDF downloads work
              without email.
            </small>
          )}
          {rule && (
            <Check
              label="Schedule is active"
              checked={data.active}
              onChange={(v) => set("active", v)}
            />
          )}
        </div>
      </FormShell>
    </Modal>
  );
}
function InvoiceDetail({ id, onClose, onChange, onEdit, system, notify }) {
  const [inv, setInv] = useState(null),
    [error, setError] = useState(""),
    [emailDialog, setEmailDialog] = useState(false),
    [recipient, setRecipient] = useState(""),
    [busy, setBusy] = useState(false),
    [payment, setPayment] = useState({
      amount: "",
      date: system.today,
      reference: "",
    });
  const reload = async () => setInv(await api("/invoices/" + id));
  useEffect(() => {
    let cancelled = false;
    setInv(null);
    setError("");
    api("/invoices/" + id)
      .then((invoice) => !cancelled && setInv(invoice))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);
  const act = async (fn, message) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
      onChange();
      notify(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (emailDialog)
    return (
      <Modal
        title="Send email to…"
        subtitle={inv?.number}
        onClose={() => setEmailDialog(false)}
      >
        <FormShell
          label="Send email"
          onClose={() => setEmailDialog(false)}
          onSubmit={async () => {
            const address = recipient.trim();
            await api(`/invoices/${id}/email`, "POST", { recipient: address });
            setEmailDialog(false);
            notify(`Email queued for ${address}`);
            reload().catch((e) => setError(e.message));
            onChange();
          }}
        >
          <Field
            label="Recipient email address"
            type="email"
            required
            maxLength={254}
            autoFocus
            value={recipient}
            onInput={(e) => setRecipient(e.target.value)}
          />
          <p class="muted">
            Send this invoice PDF to the entered address. The tenant’s saved
            email and recurring billing settings will stay the same.
          </p>
        </FormShell>
      </Modal>
    );
  return (
    <Modal
      large
      title={inv?.number || "Invoice"}
      subtitle="Invoice details and payment history"
      onClose={onClose}
    >
      <div class="form-body">
        <ErrorBox error={error} />
        {inv ? (
          <>
            <div class="detail-actions">
              <a class="btn" href={`/api/invoices/${id}/pdf`}>
                <Icon name="download" size={17} /> Download PDF
              </a>
              <Button
                secondary
                disabled={
                  busy ||
                  !system.email_configured ||
                  inv.status === "void" ||
                  !inv.snapshot.tenant.email
                }
                icon="email"
                onClick={() =>
                  act(
                    () => api(`/invoices/${id}/email`, "POST", {}),
                    "Email queued",
                  )
                }
              >
                Send email
              </Button>
              <Button
                secondary
                disabled={
                  busy || !system.email_configured || inv.status === "void"
                }
                onClick={() => {
                  setRecipient("");
                  setEmailDialog(true);
                }}
              >
                Send email to…
              </Button>
              <Button
                secondary
                disabled={
                  busy ||
                  inv.status === "void" ||
                  inv.email_jobs.some((job) => job.status === "sending")
                }
                title="Edit this invoice and refresh its saved records"
                onClick={() => onEdit(inv)}
              >
                Edit invoice
              </Button>
              {inv.status !== "void" && (
                <button
                  disabled={busy}
                  class="text-link danger"
                  onClick={() => {
                    if (
                      confirm(
                        "Void this invoice? It will remain in your records and cannot be restored.",
                      )
                    )
                      act(
                        () => api(`/invoices/${id}/void`, "POST", {}),
                        "Invoice voided",
                      );
                  }}
                >
                  Void invoice
                </button>
              )}
            </div>
            <article class="invoice-paper">
              <div class="paper-top">
                <div>
                  <h2>{inv.status === "void" ? "VOID INVOICE" : "INVOICE"}</h2>
                  <p class="invoice-number">{inv.number}</p>
                </div>
                <div class="right">
                  <b>{inv.snapshot.landlord.name}</b>
                  <p class="preserve">{inv.snapshot.landlord.address}</p>
                  <small>{inv.snapshot.landlord.email}</small>
                </div>
              </div>
              <div class="paper-parties">
                <div>
                  <span class="eyebrow">BILL TO</span>
                  <h3>{inv.snapshot.tenant.name}</h3>
                  <p class="preserve">{inv.snapshot.tenant.address}</p>
                  <small>{inv.snapshot.tenant.email}</small>
                </div>
                <div>
                  <span class="eyebrow">PROPERTY</span>
                  <h3>
                    {inv.snapshot.property.name} {inv.snapshot.property.unit}
                  </h3>
                  <p class="preserve">{inv.snapshot.property.address}</p>
                </div>
              </div>
              <div class="paper-dates">
                <span>
                  Issued <b>{dateLabel(inv.issue_date)}</b>
                </span>
                <span>
                  Due <b>{dateLabel(inv.due_date)}</b>
                </span>
                <span>
                  Period{" "}
                  <b>
                    {dateLabel(inv.period_start)} – {dateLabel(inv.period_end)}
                  </b>
                </span>
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.items.map((i) => (
                      <tr>
                        <td>
                          <b>{i.title}</b>
                          <small>{i.description}</small>
                          <small>
                            {i.category === "Corporation tax"
                              ? "Municipal Property Tax"
                              : i.category}
                          </small>
                        </td>
                        <td>{i.quantity}</td>
                        <td>
                          {money(i.rate_cents, inv.snapshot.landlord.currency)}
                        </td>
                        <td class="amount">
                          {money(
                            i.amount_cents,
                            inv.snapshot.landlord.currency,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div class="paper-total">
                <span>
                  Total{" "}
                  <b>
                    {money(inv.total_cents, inv.snapshot.landlord.currency)}
                  </b>
                </span>
                <span>
                  Paid{" "}
                  <b>{money(inv.paid_cents, inv.snapshot.landlord.currency)}</b>
                </span>
                <span class="balance">
                  Balance due{" "}
                  <b>
                    {money(inv.balance_cents, inv.snapshot.landlord.currency)}
                  </b>
                </span>
              </div>
              {inv.snapshot.landlord.payment_details && (
                <>
                  <h4>Payment details</h4>
                  <p class="preserve">
                    {inv.snapshot.landlord.payment_details}
                  </p>
                </>
              )}
              {(inv.notes || inv.snapshot.landlord.notes) && (
                <>
                  <h4>Notes</h4>
                  <p class="preserve">
                    {[inv.notes, inv.snapshot.landlord.notes]
                      .filter(Boolean)
                      .join("\n")}
                  </p>
                </>
              )}
            </article>
            <section class="detail-section">
              <h3>Payments</h3>
              {inv.payments.map((p) => (
                <div class="payment-row">
                  <span>
                    {dateLabel(p.date)} · {p.reference || "Payment"}
                  </span>
                  <b>{money(p.amount_cents, inv.snapshot.landlord.currency)}</b>
                  <button
                    class="text-link danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Remove this recorded payment?"))
                        act(
                          () => api(`/payments/${p.id}`, "DELETE"),
                          "Payment removed",
                        );
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {inv.status !== "void" && inv.balance_cents > 0 && (
                <form
                  class="payment-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(
                      () => api(`/invoices/${id}/payments`, "POST", payment),
                      "Payment recorded",
                    ).then(() =>
                      setPayment({ ...payment, amount: "", reference: "" }),
                    );
                  }}
                >
                  <Field
                    label="Amount"
                    type="number"
                    min="0.01"
                    max={inv.balance_cents / 100}
                    step="0.01"
                    required
                    value={payment.amount}
                    onInput={(e) =>
                      setPayment({ ...payment, amount: e.target.value })
                    }
                  />
                  <Field
                    label="Payment date"
                    type="date"
                    required
                    value={payment.date}
                    onInput={(e) =>
                      setPayment({ ...payment, date: e.target.value })
                    }
                  />
                  <Field
                    label="Reference / method"
                    value={payment.reference}
                    onInput={(e) =>
                      setPayment({ ...payment, reference: e.target.value })
                    }
                  />
                  <Button disabled={busy} type="submit">
                    Record payment
                  </Button>
                </form>
              )}
            </section>
            {inv.email_jobs.length > 0 && (
              <section class="detail-section">
                <h3>Email history</h3>
                {inv.email_jobs.map((j) => (
                  <div class="payment-row">
                    <span>
                      {j.recipient}
                      <small>
                        {j.error || j.sent_at || "Waiting for delivery"}
                      </small>
                    </span>
                    <Badge status={j.status} />
                  </div>
                ))}
              </section>
            )}
            <p class="muted">
              This invoice keeps a snapshot of its billing details. Editing it
              refreshes that snapshot from the current landlord, tenant and
              property records.
            </p>
          </>
        ) : (
          <p>Loading invoice…</p>
        )}
      </div>
    </Modal>
  );
}
function Profile({ profile, profiles, onSelect, onSaved, onLogout }) {
  const [data, setData] = useState(profile),
    [creating, setCreating] = useState(false),
    [password, setPassword] = useState({ current: "", password: "" }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setData(profile);
    setCreating(false);
  }, [profile]);
  const set = (k, v) => setData((current) => ({ ...current, [k]: v }));
  return (
    <div class="settings-grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Landlord & invoice details</h3>
            <p>Shown on every new invoice.</p>
          </div>
        </div>
        <FormShell
          label={creating ? "Create profile" : "Save profile"}
          onClose={() => {
            setCreating(false);
            setData(profile);
          }}
          onSubmit={async () => {
            const saved = creating
              ? await api("/profiles", "POST", data)
              : await api(`/profiles/${profile.id}`, "PUT", data);
            setCreating(false);
            onSaved(saved.id);
          }}
        >
          <div class="form-grid">
            <Field
              label="Landlord / business name"
              required
              wide
              value={data.name}
              onInput={(e) => set("name", e.target.value)}
            />
            <Field
              label="Contact email"
              type="email"
              value={data.email}
              onInput={(e) => set("email", e.target.value)}
            />
            <Field
              label="Phone"
              value={data.phone}
              onInput={(e) => set("phone", e.target.value)}
            />
            <TextArea
              label="Address"
              value={data.address}
              onChange={(v) => set("address", v)}
            />
            <Field
              label="Tax ID / GSTIN (optional)"
              value={data.tax_id}
              onInput={(e) => set("tax_id", e.target.value)}
            />
            <Field
              label="Invoice number prefix"
              pattern="[A-Z0-9-]{1,12}"
              required
              maxLength="12"
              hint="Use a unique prefix for each landlord, for example PATEL or KEY. A historical prefix cannot be reused."
              value={data.prefix}
              onInput={(e) => set("prefix", e.target.value)}
            />
            <Select
              label="Currency"
              value={data.currency}
              onChange={(v) => set("currency", v)}
            >
              {currencyOptions.map((c) => (
                <option>{c}</option>
              ))}
            </Select>
            <Field
              label="Billing time zone"
              required
              value={data.timezone}
              placeholder="Asia/Kolkata"
              onInput={(e) => set("timezone", e.target.value)}
            />
            <TextArea
              label="Bank / UPI / payment instructions"
              value={data.payment_details}
              onChange={(v) => set("payment_details", v)}
            />
            <TextArea
              label="Default invoice footer / notes"
              value={data.notes}
              onChange={(v) => set("notes", v)}
            />
          </div>
        </FormShell>
      </section>
      <aside>
        <section class="panel profile-list">
          <div class="panel-head">
            <div>
              <h3>Landlord profiles</h3>
              <p>Select a profile to manage its portfolio.</p>
            </div>
          </div>
          <div class="profile-options">
            {profiles.map((item) => (
              <button
                type="button"
                class={item.id === profile.id && !creating ? "selected" : ""}
                onClick={() => {
                  setCreating(false);
                  setData(item);
                  onSelect(item.id);
                }}
              >
                <span class="avatar">
                  {(item.name || "L").slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <b>{item.name || "Incomplete profile"}</b>
                  <small>
                    {item.currency} · {item.prefix}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <Button
            secondary
            icon="plus"
            type="button"
            onClick={() => {
              setCreating(true);
              setData(blankProfile());
            }}
          >
            Add landlord profile
          </Button>
        </section>
        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Account security</h3>
              <p>Change your sign-in password.</p>
            </div>
          </div>
          <form
            class="form-body"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/password", "POST", password);
                onLogout();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ErrorBox error={error} />
            <Field
              label="Current password"
              type="password"
              autoComplete="current-password"
              required
              value={password.current}
              onInput={(e) =>
                setPassword({ ...password, current: e.target.value })
              }
            />
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              minLength="12"
              maxLength="128"
              required
              hint="At least 12 characters. You’ll sign in again after changing it."
              value={password.password}
              onInput={(e) =>
                setPassword({ ...password, password: e.target.value })
              }
            />
            <Button disabled={busy} type="submit">
              Update password
            </Button>
          </form>
        </section>
        <div class="tip">
          <Icon name="invoices" />
          <h3>Your history stays intact</h3>
          <p>
            Profile changes apply to new invoices. Use Edit invoice when you
            want an existing invoice to use the latest saved details.
          </p>
        </div>
      </aside>
    </div>
  );
}
function App() {
  const initialRoute = useRef(readRoute()).current;
  const [auth, setAuth] = useState(null),
    [page, setPage] = useState(initialRoute.page),
    [mobile, setMobile] = useState(false),
    [profiles, setProfiles] = useState([]),
    [profileId, setProfileId] = useState(null),
    [profile, setProfile] = useState(null),
    [system, setSystem] = useState(null),
    [properties, setProperties] = useState([]),
    [tenants, setTenants] = useState([]),
    [rules, setRules] = useState([]),
    [invoices, setInvoices] = useState({ items: [], total: 0 }),
    [dash, setDash] = useState(null),
    [emails, setEmails] = useState([]),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [pagination, setPagination] = useState(1),
    [modal, setModal] = useState(
      initialRoute.invoiceId
        ? { kind: "detail", id: initialRoute.invoiceId }
        : null,
    ),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const notify = (message) => setToast(message);
  useEffect(() => {
    setRoute(initialRoute.path, true);
    const followHistory = () => {
      const route = readRoute();
      setPage(route.page);
      setModal(
        route.invoiceId ? { kind: "detail", id: route.invoiceId } : null,
      );
      setMobile(false);
      setError("");
    };
    window.addEventListener("popstate", followHistory);
    return () => window.removeEventListener("popstate", followHistory);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const refresh = () => setRevision((v) => v + 1);
  const checkAuth = () =>
    api("/me")
      .then(setAuth)
      .catch((e) => {
        setAuth(false);
        if (e.status !== 401) setError(e.message);
      });
  useEffect(() => {
    checkAuth();
    const expired = () => {
      setAuth(false);
      setModal(null);
      setProfiles([]);
      setProfileId(null);
      setProfile(null);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    api("/profiles")
      .then((items) => {
        if (cancelled) return;
        setProfiles(items);
        const stored = Number(localStorage.getItem("rentfolio-landlord"));
        const selected = items.find((item) => item.id === profileId)
          ? profileId
          : items.find((item) => item.id === stored)?.id || items[0]?.id;
        if (selected && selected !== profileId) setProfileId(selected);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [auth]);
  useEffect(() => {
    if (!auth || !profileId) return;
    let cancelled = false;
    setLoading(true);
    const scope = `?landlord_id=${profileId}`;
    Promise.all([
      api("/profiles"),
      api("/system" + scope),
      api("/properties" + scope),
      api("/tenants" + scope),
      api("/rules" + scope),
      api("/dashboard" + scope),
    ])
      .then(([allProfiles, s, pr, t, r, d]) => {
        if (cancelled) return;
        const p = allProfiles.find((item) => item.id === profileId);
        if (!p) throw new Error("Landlord profile not found");
        setProfiles(allProfiles);
        setProfile(p);
        setSystem(s);
        setProperties(pr);
        setTenants(t);
        setRules(r);
        setDash(d);
        setError("");
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [auth, profileId, revision]);
  useEffect(() => {
    if (!auth || !profileId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (page === "invoices")
        api(
          `/invoices?landlord_id=${profileId}&search=${encodeURIComponent(search)}&status=${status}&page=${pagination}`,
        )
          .then((x) => !cancelled && setInvoices(x))
          .catch((e) => !cancelled && setError(e.message));
      if (page === "email")
        api(`/emails?landlord_id=${profileId}`)
          .then((x) => !cancelled && setEmails(x))
          .catch((e) => !cancelled && setError(e.message));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [auth, profileId, page, search, status, pagination, revision]);
  const selectProfile = (selected) => {
    const next = Number(selected);
    if (next === profileId) return;
    localStorage.setItem("rentfolio-landlord", String(next));
    setProfileId(next);
    setProfile(null);
    setModal(null);
    setPagination(1);
    setSearch("");
    setStatus("");
  };
  const go = (p) => {
    setPage(p);
    setModal(null);
    setRoute(`/${p}`);
    setMobile(false);
    setError("");
  };
  const openInvoice = (id) => {
    setPage("invoices");
    setModal({ kind: "detail", id });
    setRoute(`/invoices/${id}`);
  };
  const createInvoice = () => {
    if (!profile.name) {
      go("profile");
      notify("Complete your landlord profile first.");
    } else if (!tenants.some((t) => t.active)) {
      go("tenants");
      notify("Add an active tenant first.");
    } else setModal({ kind: "invoice" });
  };
  const logout = async () => {
    try {
      await api("/logout", "POST", {});
      setAuth(false);
      setProfiles([]);
      setProfileId(null);
      setProfile(null);
    } catch (e) {
      setError(e.message);
    }
  };
  const save = async (data) => {
    const endpoint = {
      property: "properties",
      tenant: "tenants",
      automation: "rules",
      invoice: "invoices",
    }[modal.kind];
    const result = await api(
      "/" +
        endpoint +
        (modal.record ? "/" + modal.record.id : "") +
        (modal.kind === "property" && !modal.record
          ? `?landlord_id=${profileId}`
          : ""),
      modal.record ? "PUT" : "POST",
      data,
    );
    const wasInvoice = modal.kind === "invoice";
    if (wasInvoice) {
      setPage("invoices");
      setRoute(`/invoices/${result.id}`);
    }
    setModal(wasInvoice ? { kind: "detail", id: result.id } : null);
    refresh();
    notify("Saved successfully");
  };
  if (auth === null)
    return <div class="loading-screen">Opening your workspace…</div>;
  if (!auth)
    return (
      <>
        <ErrorBox error={error} />
        <Login onLogin={checkAuth} />
      </>
    );
  if (!profile || !system || !dash)
    return (
      <div class="loading-screen">
        <ErrorBox error={error} />
        <p>Loading your workspace…</p>
        {error && <Button onClick={refresh}>Retry</Button>}
      </div>
    );
  const titles = {
    dashboard: ["Overview", "A clear view of your rental finances."],
    invoices: [
      "Invoices",
      "Create, track and download your property invoices.",
    ],
    tenants: ["Tenants", "Good records make better rental relationships."],
    properties: ["Properties", "A home for every property in your portfolio."],
    automations: [
      "Recurring Billing",
      "Set your billing on a reliable schedule.",
    ],
    email: [
      "Email delivery",
      "Track optional invoice emails and delivery attempts.",
    ],
    profile: [
      "Landlord profiles",
      "Manage each landlord and its invoice identity.",
    ],
  };
  const total = dash.totals.find((t) => t.currency === profile.currency) || {};
  return (
    <div class="app-shell">
      <aside class={"sidebar " + (mobile ? "open" : "")}>
        <div class="brand">
          <span class="brand-icon">
            <Icon name="properties" size={24} />
          </span>
          rentfolio<span class="brand-dot">.</span>
        </div>
        <div class="workspace-label">LANDLORD WORKSPACE</div>
        <label class="workspace-switcher">
          <span>Current profile</span>
          <select
            aria-label="Current landlord profile"
            value={profileId}
            onChange={(e) => selectProfile(e.target.value)}
          >
            {profiles.map((item) => (
              <option value={item.id}>
                {item.name || "Incomplete profile"}
              </option>
            ))}
          </select>
        </label>
        <nav>
          {[
            "dashboard",
            "invoices",
            "tenants",
            "properties",
            "automations",
          ].map((p) => (
            <button
              class={page === p ? "nav-item active" : "nav-item"}
              onClick={() => go(p)}
            >
              <Icon name={p} />
              <span>
                {p === "dashboard"
                  ? "Overview"
                  : p === "automations"
                    ? "Recurring Billing"
                    : p[0].toUpperCase() + p.slice(1)}
              </span>
              {p === "automations" && dash.active_rules > 0 && (
                <b>{dash.active_rules}</b>
              )}
            </button>
          ))}
        </nav>
        <div class="sidebar-bottom">
          <button
            class={page === "email" ? "nav-item active" : "nav-item"}
            onClick={() => go("email")}
          >
            <Icon name="email" /> Email delivery
            {dash.failed_emails > 0 && <b>{dash.failed_emails}</b>}
          </button>
          <button
            class={page === "profile" ? "nav-item active" : "nav-item"}
            onClick={() => go("profile")}
          >
            <Icon name="profile" /> Landlord profiles
          </button>
          <div class="account">
            <span class="avatar">
              {(profile.name || auth.email).slice(0, 1).toUpperCase()}
            </span>
            <div>
              <b>{profile.name || "Your workspace"}</b>
              <small>Administrator</small>
            </div>
            <button class="icon-btn" onClick={logout} aria-label="Sign out">
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          class="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div class="main-shell">
        <header class="topbar">
          <button
            class="icon-btn mobile-menu"
            onClick={() => setMobile(!mobile)}
            aria-label="Toggle navigation"
          >
            <Icon name="menu" />
          </button>
          <div class="breadcrumb">
            Workspace <span>/</span> <b>{titles[page][0]}</b>
          </div>
          <span class="today">
            <span class="live-dot" />
            {dateLabel(system.today)}
          </span>
        </header>
        <main class="content">
          <div class="page-heading">
            <div>
              <span class="eyebrow">
                {page === "dashboard"
                  ? "YOUR RENTAL WORKSPACE"
                  : "PROPERTY MANAGEMENT"}
              </span>
              <h1>{titles[page][0]}</h1>
              <p>{titles[page][1]}</p>
            </div>
            {["dashboard", "invoices"].includes(page) && (
              <Button icon="plus" onClick={createInvoice}>
                Create invoice
              </Button>
            )}
            {page === "properties" && (
              <Button
                icon="plus"
                onClick={() => setModal({ kind: "property" })}
              >
                Add property
              </Button>
            )}
            {page === "tenants" && (
              <Button
                icon="plus"
                onClick={() =>
                  properties.length
                    ? setModal({ kind: "tenant" })
                    : (go("properties"),
                      notify("Add a property before adding tenants."))
                }
              >
                Add tenant
              </Button>
            )}
            {page === "automations" && (
              <Button
                icon="plus"
                onClick={() =>
                  tenants.some((t) => t.active)
                    ? setModal({ kind: "automation" })
                    : (go("tenants"), notify("Add an active tenant first."))
                }
              >
                Create recurring schedule
              </Button>
            )}
          </div>
          <ErrorBox error={error} />
          {loading && <div class="loading-bar" aria-label="Refreshing" />}
          {page === "dashboard" && (
            <>
              <div class="stats-grid">
                {[
                  [
                    "Total invoiced",
                    total.billed,
                    "invoices",
                    "All issued invoices",
                  ],
                  ["Collected", total.collected, "check", "Payments recorded"],
                  [
                    "Outstanding",
                    total.outstanding,
                    "clock",
                    "Awaiting payment",
                  ],
                  [
                    "Overdue",
                    total.overdue,
                    "automations",
                    "Past the due date",
                  ],
                ].map(([label, value, icon, sub], i) => (
                  <div class={"stat-card stat-" + i}>
                    <div class="stat-top">
                      <span>{label}</span>
                      <Icon name={icon} size={18} />
                    </div>
                    <strong>{money(value, profile.currency)}</strong>
                    <small>{sub}</small>
                  </div>
                ))}
              </div>
              {dash.totals
                .filter((t) => t.currency !== profile.currency)
                .map((t) => (
                  <div class="notice">
                    {t.currency}: {money(t.billed, t.currency)} invoiced ·{" "}
                    {money(t.outstanding, t.currency)} outstanding
                  </div>
                ))}
              <div class="dashboard-grid">
                <section class="panel recent">
                  <div class="panel-head">
                    <div>
                      <h3>Recent invoices</h3>
                      <p>Your latest billing activity, at a glance.</p>
                    </div>
                    <button class="text-link" onClick={() => go("invoices")}>
                      View all <Icon name="arrow" size={15} />
                    </button>
                  </div>
                  {dash.recent.length ? (
                    <InvoiceTable
                      items={dash.recent}
                      onOpen={openInvoice}
                      currency={profile.currency}
                    />
                  ) : (
                    <Empty
                      title="Your first invoice starts here"
                      description="Add a property and tenant, then create an invoice for rent or any other charge."
                      action={
                        <Button secondary icon="plus" onClick={createInvoice}>
                          Create your first invoice
                        </Button>
                      }
                    />
                  )}
                  <div class="panel-foot">
                    <Icon name="download" size={15} /> A PDF is available for
                    every invoice.
                  </div>
                </section>
                <aside class="dashboard-side">
                  <section class="automation-card">
                    <div class="round-icon">
                      <Icon name="automations" size={24} />
                    </div>
                    <span class="eyebrow">PUT BILLING ON AUTOPILOT</span>
                    <h2>
                      A little setup.
                      <br />A lot less admin.
                    </h2>
                    <p>
                      Let your invoices take care of themselves—weekly, monthly
                      or yearly.
                    </p>
                    <button onClick={() => go("automations")}>
                      Manage recurring billing <Icon name="arrow" size={17} />
                    </button>
                    <div class="automation-count">
                      <span class="live-dot" />
                      {dash.active_rules} active schedules
                    </div>
                  </section>
                  <section class="portfolio-card">
                    <h3>Your portfolio</h3>
                    <div>
                      <span>
                        <Icon name="properties" /> Active properties
                      </span>
                      <b>{dash.properties}</b>
                    </div>
                    <div>
                      <span>
                        <Icon name="tenants" /> Active tenants
                      </span>
                      <b>{dash.tenants}</b>
                    </div>
                  </section>
                </aside>
              </div>
              {(!profile.name ||
                !properties.length ||
                !tenants.length ||
                dash.rule_errors > 0 ||
                dash.failed_emails > 0) && (
                <section class="panel getting-started">
                  <h3>
                    {dash.rule_errors || dash.failed_emails
                      ? "Needs your attention"
                      : "Make yourself at home"}
                  </h3>
                  <div class="setup-steps">
                    {!profile.name && (
                      <button onClick={() => go("profile")}>
                        <span>01</span> Complete landlord profile{" "}
                        <Icon name="arrow" />
                      </button>
                    )}
                    {!properties.length && (
                      <button onClick={() => go("properties")}>
                        <span>02</span> Add your first property{" "}
                        <Icon name="arrow" />
                      </button>
                    )}
                    {!tenants.length && (
                      <button onClick={() => go("tenants")}>
                        <span>03</span> Add a tenant <Icon name="arrow" />
                      </button>
                    )}
                    {dash.rule_errors > 0 && (
                      <button onClick={() => go("automations")}>
                        {dash.rule_errors} schedules need attention{" "}
                        <Icon name="arrow" />
                      </button>
                    )}
                    {dash.failed_emails > 0 && (
                      <button onClick={() => go("email")}>
                        {dash.failed_emails} email deliveries need attention{" "}
                        <Icon name="arrow" />
                      </button>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
          {page === "invoices" && (
            <section class="panel">
              <div class="filter-bar">
                <label class="search">
                  <Icon name="search" size={18} />
                  <input
                    aria-label="Search invoices"
                    placeholder="Search invoice, tenant or property…"
                    value={search}
                    onInput={(e) => {
                      setSearch(e.target.value);
                      setPagination(1);
                    }}
                  />
                </label>
                <select
                  aria-label="Invoice status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPagination(1);
                  }}
                >
                  <option value="">All statuses</option>
                  {["unpaid", "partial", "paid", "overdue", "void"].map((s) => (
                    <option value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
              {invoices.items.length ? (
                <InvoiceTable
                  items={invoices.items}
                  onOpen={openInvoice}
                  currency={profile.currency}
                />
              ) : (
                <Empty
                  title={
                    search || status
                      ? "No matching invoices"
                      : "No invoices yet"
                  }
                  description="Your manually created and scheduled invoices will appear here."
                />
              )}
              <div class="pagination">
                <small>
                  {invoices.total} invoices · Page {pagination}
                </small>
                <Button
                  secondary
                  disabled={pagination <= 1}
                  onClick={() => setPagination((v) => v - 1)}
                >
                  Previous
                </Button>
                <Button
                  secondary
                  disabled={pagination * 50 >= invoices.total}
                  onClick={() => setPagination((v) => v + 1)}
                >
                  Next
                </Button>
              </div>
            </section>
          )}
          {page === "properties" &&
            (properties.length ? (
              <div class="property-grid">
                {properties.map((p) => (
                  <article class="property-card">
                    <div class="property-visual">
                      <Icon name="properties" size={44} />
                      <Badge status={p.active ? "active" : "archived"} />
                    </div>
                    <div class="property-body">
                      <h3>{p.name}</h3>
                      <p>{p.unit || "Whole property"}</p>
                      <p class="address">{p.address}</p>
                      <div>
                        <small>
                          {
                            tenants.filter(
                              (t) => t.property_id === p.id && t.active,
                            ).length
                          }{" "}
                          active tenants
                        </small>
                        <button
                          class="text-link"
                          onClick={() =>
                            setModal({ kind: "property", record: p })
                          }
                        >
                          Edit property <Icon name="arrow" size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <section class="panel">
                <Empty
                  icon="properties"
                  title="Build your property portfolio"
                  description="Add a house, apartment, floor, shop or office to get started."
                  action={
                    <Button
                      icon="plus"
                      onClick={() => setModal({ kind: "property" })}
                    >
                      Add property
                    </Button>
                  }
                />
              </section>
            ))}
          {page === "tenants" && (
            <section class="panel">
              {tenants.length ? (
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Tenant</th>
                        <th>Property</th>
                        <th>Default rent</th>
                        <th>Lease ends</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {tenants.map((t) => (
                        <tr>
                          <td>
                            <b>{t.name}</b>
                            <small>
                              {t.email || t.phone || "No contact details"}
                            </small>
                          </td>
                          <td>
                            {t.property_name}
                            <small>{t.unit}</small>
                          </td>
                          <td class="amount">
                            {money(t.rent_cents, profile.currency)}
                          </td>
                          <td>{dateLabel(t.lease_end)}</td>
                          <td>
                            <Badge status={t.active ? "active" : "archived"} />
                          </td>
                          <td>
                            <button
                              class="text-link"
                              onClick={() =>
                                setModal({ kind: "tenant", record: t })
                              }
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  icon="tenants"
                  title="Meet your tenant directory"
                  description="Keep contact details, property assignments, rent and lease dates in one place."
                />
              )}
            </section>
          )}
          {page === "automations" && (
            <>
              <div class="notice automation-notice">
                <Icon name="clock" />
                <span>
                  Schedules run every minute in your billing time zone (
                  {profile.timezone}). Email is optional; generated PDFs are
                  always available.
                </span>
                <button
                  class="text-link"
                  onClick={async () => {
                    try {
                      const result = await api(
                        `/rules/run?landlord_id=${profileId}`,
                        "POST",
                        {},
                      );
                      refresh();
                      notify(
                        `${result.created} invoices created from due schedules`,
                      );
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Run due now
                </button>
              </div>
              {rules.length ? (
                <div class="rules-grid">
                  {rules.map((r) => (
                    <article class="panel rule-card">
                      <div class="rule-top">
                        <span class="round-icon">
                          <Icon name="automations" />
                        </span>
                        <Badge status={r.active ? "active" : "paused"} />
                      </div>
                      <h3>{r.name}</h3>
                      <p>
                        {r.tenant_name} · {r.property_name}
                      </p>
                      <div class="rule-details">
                        <span>
                          Frequency <b>{r.frequency}</b>
                        </span>
                        <span>
                          Next invoice <b>{dateLabel(r.next_date)}</b>
                        </span>
                        <span>
                          Delivery{" "}
                          <b>{r.auto_email ? "PDF + email" : "PDF only"}</b>
                        </span>
                      </div>
                      {r.last_error && <ErrorBox error={r.last_error} />}
                      <button
                        class="text-link"
                        onClick={() =>
                          setModal({ kind: "automation", record: r })
                        }
                      >
                        Edit schedule <Icon name="arrow" size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <section class="panel">
                  <Empty
                    icon="automations"
                    title="Recurring invoices, without the repetition"
                    description="Create schedules for rent, maintenance, municipal property tax or any regular charge."
                  />
                </section>
              )}
            </>
          )}
          {page === "email" && (
            <>
              <div class="notice">
                <Icon name="email" />{" "}
                {system.email_configured
                  ? "SMTP is configured. Queued emails are processed every minute."
                  : "Email is optional and currently disabled. Configure SMTP in your .env file to enable delivery."}
                <button class="text-link" onClick={refresh}>
                  Refresh
                </button>
              </div>
              <section class="panel">
                {emails.length ? (
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Invoice</th>
                          <th>Recipient</th>
                          <th>Delivery</th>
                          <th>Attempts</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {emails.map((e) => (
                          <tr>
                            <td>
                              <button
                                class="text-link"
                                onClick={() => openInvoice(e.invoice_id)}
                              >
                                {e.number}
                              </button>
                            </td>
                            <td>{e.recipient}</td>
                            <td>
                              <Badge status={e.status} />
                              <small class="email-error">
                                {e.error || e.sent_at}
                              </small>
                            </td>
                            <td>{e.attempts}</td>
                            <td>
                              {["failed", "uncertain"].includes(e.status) && (
                                <button
                                  class="text-link"
                                  onClick={async () => {
                                    if (
                                      e.status === "uncertain" &&
                                      !confirm(
                                        "This email may already have been delivered. Have you checked before retrying?",
                                      )
                                    )
                                      return;
                                    try {
                                      await api(
                                        `/emails/${e.id}/retry`,
                                        "POST",
                                        {},
                                      );
                                      refresh();
                                      notify("Delivery queued again");
                                    } catch (error) {
                                      setError(error.message);
                                    }
                                  }}
                                >
                                  Retry
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon="email"
                    title="No emails queued"
                    description="Download invoices anytime, or choose email delivery when you need it."
                  />
                )}
              </section>
            </>
          )}
          {page === "profile" && (
            <Profile
              key={revision}
              profile={profile}
              profiles={profiles}
              onSelect={selectProfile}
              onSaved={(savedId) => {
                selectProfile(savedId);
                refresh();
                notify("Profile updated");
              }}
              onLogout={() => {
                setAuth(false);
                setProfile(null);
              }}
            />
          )}
          <footer class="main-footer">
            <span>
              rentfolio<span class="brand-dot">.</span>{" "}
              <span class="footer-tag">A little more organized.</span>
            </span>
            <span>Private landlord workspace</span>
          </footer>
        </main>
      </div>
      {modal && ["property", "tenant"].includes(modal.kind) && (
        <RecordEditor
          kind={modal.kind}
          record={modal.record}
          properties={properties}
          currency={profile.currency}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
      {modal && ["invoice", "automation"].includes(modal.kind) && (
        <BillingEditor
          rule={modal.kind === "automation"}
          record={modal.record}
          tenants={tenants}
          profile={profile}
          system={system}
          onClose={() => {
            if (modal.kind === "invoice" && modal.record) {
              setModal({ kind: "detail", id: modal.record.id });
              setRoute(`/invoices/${modal.record.id}`, true);
            } else setModal(null);
          }}
          onSave={save}
        />
      )}
      {modal?.kind === "detail" && (
        <InvoiceDetail
          id={modal.id}
          onClose={() => go("invoices")}
          onChange={refresh}
          onEdit={(invoice) => setModal({ kind: "invoice", record: invoice })}
          system={system}
          notify={notify}
        />
      )}
      {toast && (
        <div class="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
render(<App />, document.getElementById("app"));
