import { openDatabase } from "../server/db.js";
import { hashPassword } from "../server/auth.js";
// Pipe the replacement password via stdin; do not place it in process arguments.
let password = "";
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, "");
const email = process.argv[2];
if (!email)
  throw new Error(
    "Usage: npm run reset-password -- admin@example.com < /secure/password-file",
  );
const db = openDatabase();
const user = db
  .prepare("SELECT id FROM users WHERE email=?")
  .get(email.toLowerCase());
if (!user) throw new Error("Administrator not found");
db.prepare("UPDATE users SET password=? WHERE id=?").run(
  await hashPassword(password),
  user.id,
);
db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
db.close();
console.log("Password reset; existing sessions revoked.");
