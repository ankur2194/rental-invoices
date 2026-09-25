import { DatabaseSync, backup } from "node:sqlite";
import { resolve } from "node:path";
const source = process.env.DB_PATH || "./data/rental.sqlite";
const destination = process.argv[2];
if (!destination) {
  console.error("Usage: npm run backup -- /path/to/backup.sqlite");
  process.exit(1);
}
if (resolve(source) === resolve(destination))
  throw new Error("Backup must use a different path");
const db = new DatabaseSync(source, { readOnly: true });
await backup(db, destination);
db.close();
console.log(`Backup saved to ${destination}`);
