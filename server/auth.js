import {
  scrypt as scryptCallback,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { AppError } from "./domain.js";
const scrypt = promisify(scryptCallback);
const passwordSchema = z.string().min(12).max(128);
export async function hashPassword(password) {
  passwordSchema.parse(password);
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(":");
  const result = await scrypt(password, salt, 64);
  return timingSafeEqual(Buffer.from(hex, "hex"), result);
}
const digest = (token) => createHash("sha256").update(token).digest("hex");
export async function bootstrap(db, config) {
  if (db.prepare("SELECT id FROM users LIMIT 1").get()) return;
  if (config.adminPassword === "replace-with-a-long-random-password")
    throw new Error("Replace the example ADMIN_PASSWORD before first startup");
  const email = z.email().parse(config.adminEmail).toLowerCase();
  const password = await hashPassword(config.adminPassword);
  db.prepare("INSERT INTO users(email,password) VALUES(?,?)").run(
    email,
    password,
  );
}
export async function registerAuth(app, db, config) {
  const options = {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: config.secureCookie,
  };
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers["x-requested-with"] !== "rental-portal")
        throw new AppError("Missing request protection header", 403);
      if (req.headers.origin && req.headers.origin !== config.appOrigin)
        throw new AppError("Untrusted request origin", 403);
    }
    if (req.url.split("?")[0] === "/api/login") return;
    const token = req.cookies.session;
    req.user =
      token &&
      db
        .prepare(
          "SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
        )
        .get(digest(token), Date.now());
    if (!req.user) throw new AppError("Please sign in", 401);
  });
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const input = z
        .object({
          email: z.email().max(254),
          password: z.string().min(1).max(128),
        })
        .parse(req.body);
      const user = db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(input.email.toLowerCase());
      // Do equivalent password work for unknown accounts.
      const stored =
        user?.password || `00000000000000000000000000000000:${"00".repeat(64)}`;
      const valid = await verifyPassword(input.password, stored);
      if (!user || !valid)
        throw new AppError("Incorrect email or password", 401);
      db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        digest(token),
        user.id,
        Date.now() + 7 * 86400000,
      );
      reply.setCookie("session", token, { ...options, maxAge: 7 * 86400 });
      return { email: user.email };
    },
  );
  app.get("/api/me", async (req) => req.user);
  app.post("/api/logout", async (req, reply) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(
      digest(req.cookies.session),
    );
    reply.clearCookie("session", options);
    return { ok: true };
  });
  app.post(
    "/api/password",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const input = z
        .object({ current: z.string().max(128), password: passwordSchema })
        .parse(req.body);
      const user = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(req.user.id);
      if (!(await verifyPassword(input.current, user.password)))
        throw new AppError("Current password is incorrect");
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        await hashPassword(input.password),
        user.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      reply.clearCookie("session", options);
      return { ok: true };
    },
  );
}
