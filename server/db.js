import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(
  path = process.env.DB_PATH || "./data/rental.sqlite",
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    INSERT OR IGNORE INTO profile VALUES(1, '{"name":"","email":"","phone":"","address":"","tax_id":"","payment_details":"","notes":"","currency":"INR","timezone":"Asia/Kolkata","prefix":"INV"}');
    CREATE TABLE IF NOT EXISTS properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL REFERENCES properties(id), name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', tax_id TEXT NOT NULL DEFAULT '', rent_cents INTEGER NOT NULL DEFAULT 0, deposit_cents INTEGER NOT NULL DEFAULT 0, lease_start TEXT NOT NULL DEFAULT '', lease_end TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS rules (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, frequency TEXT NOT NULL, anchor_date TEXT NOT NULL, next_date TEXT NOT NULL, end_date TEXT NOT NULL DEFAULT '', due_days INTEGER NOT NULL, items TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', auto_email INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, last_error TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, tenant_id INTEGER NOT NULL REFERENCES tenants(id), rule_id INTEGER REFERENCES rules(id), occurrence TEXT, issue_date TEXT NOT NULL, due_date TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, snapshot TEXT NOT NULL, items TEXT NOT NULL, notes TEXT NOT NULL, total_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'issued', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(rule_id, occurrence));
    CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), amount_cents INTEGER NOT NULL, date TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS email_jobs (id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), recipient TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', sent_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS invoice_date_idx ON invoices(issue_date);
    CREATE INDEX IF NOT EXISTS invoice_tenant_idx ON invoices(tenant_id);
    CREATE INDEX IF NOT EXISTS payment_invoice_idx ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS email_status_idx ON email_jobs(status,next_attempt);
    PRAGMA user_version=1;`);
  return db;
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export const getProfile = (db) =>
  JSON.parse(db.prepare("SELECT data FROM profile WHERE id=1").get().data);
