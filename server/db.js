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
    CREATE INDEX IF NOT EXISTS email_status_idx ON email_jobs(status,next_attempt);`);
  migrate(db);
  return db;
}
const defaultProfile =
  '{"name":"","email":"","phone":"","address":"","tax_id":"","payment_details":"","notes":"","currency":"INR","timezone":"Asia/Kolkata","prefix":"INV"}';
function hasColumn(db, table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
}
function migrate(db) {
  let version = db.prepare("PRAGMA user_version").get().user_version;
  if (version < 2)
    transaction(db, () => {
      db.exec(`CREATE TABLE IF NOT EXISTS landlord_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL
    )`);
      const legacy = db.prepare("SELECT data FROM profile WHERE id=1").get();
      if (!db.prepare("SELECT id FROM landlord_profiles LIMIT 1").get())
        db.prepare("INSERT INTO landlord_profiles(id,data) VALUES(1,?)").run(
          legacy?.data || defaultProfile,
        );
      if (!hasColumn(db, "properties", "landlord_id"))
        db.exec(
          "ALTER TABLE properties ADD COLUMN landlord_id INTEGER REFERENCES landlord_profiles(id)",
        );
      db.prepare(
        "UPDATE properties SET landlord_id=1 WHERE landlord_id IS NULL",
      ).run();
      if (!hasColumn(db, "invoices", "landlord_id"))
        db.exec(
          "ALTER TABLE invoices ADD COLUMN landlord_id INTEGER REFERENCES landlord_profiles(id)",
        );
      db.prepare(
        `UPDATE invoices SET landlord_id=COALESCE(
        (SELECT p.landlord_id FROM tenants t JOIN properties p ON p.id=t.property_id WHERE t.id=invoices.tenant_id),
        1
      ) WHERE landlord_id IS NULL`,
      ).run();
      db.exec(`CREATE INDEX IF NOT EXISTS property_landlord_idx ON properties(landlord_id);
        CREATE INDEX IF NOT EXISTS invoice_landlord_idx ON invoices(landlord_id);
        CREATE TRIGGER IF NOT EXISTS property_landlord_required_insert
          BEFORE INSERT ON properties WHEN NEW.landlord_id IS NULL
          BEGIN SELECT RAISE(ABORT, 'Property requires a landlord profile'); END;
        CREATE TRIGGER IF NOT EXISTS property_landlord_required_update
          BEFORE UPDATE OF landlord_id ON properties WHEN NEW.landlord_id IS NULL
          BEGIN SELECT RAISE(ABORT, 'Property requires a landlord profile'); END;
        CREATE TRIGGER IF NOT EXISTS invoice_landlord_required_insert
          BEFORE INSERT ON invoices WHEN NEW.landlord_id IS NULL
          BEGIN SELECT RAISE(ABORT, 'Invoice requires a landlord profile'); END;
        CREATE TRIGGER IF NOT EXISTS invoice_landlord_required_update
          BEFORE UPDATE OF landlord_id ON invoices WHEN NEW.landlord_id IS NULL
          BEGIN SELECT RAISE(ABORT, 'Invoice requires a landlord profile'); END;
        PRAGMA user_version=2;`);
    });
  version = db.prepare("PRAGMA user_version").get().user_version;
  if (version < 3)
    transaction(db, () => {
      if (!hasColumn(db, "invoices", "recreated_from_id"))
        db.exec(
          "ALTER TABLE invoices ADD COLUMN recreated_from_id INTEGER REFERENCES invoices(id)",
        );
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS invoice_recreated_from_idx ON invoices(recreated_from_id) WHERE recreated_from_id IS NOT NULL;
        PRAGMA user_version=3;`);
    });
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
export function getProfile(db, id) {
  const row = id
    ? db.prepare("SELECT * FROM landlord_profiles WHERE id=?").get(id)
    : db.prepare("SELECT * FROM landlord_profiles ORDER BY id LIMIT 1").get();
  if (!row) return null;
  return { id: row.id, ...JSON.parse(row.data) };
}
export const listProfiles = (db) =>
  db
    .prepare("SELECT * FROM landlord_profiles ORDER BY id")
    .all()
    .map((row) => ({ id: row.id, ...JSON.parse(row.data) }));
