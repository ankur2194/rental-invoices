import nodemailer from "nodemailer";
import { getInvoice } from "./billing.js";
import { makePdf } from "./pdf.js";

export function createMailer(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  return {
    from: env.SMTP_FROM,
    transport: nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: env.SMTP_SECURE === "true",
      requireTLS: env.SMTP_SECURE !== "true",
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 15000,
      socketTimeout: 30000,
    }),
  };
}
export async function processEmailJobs(db, mailer) {
  if (!mailer) return;
  const jobs = db
    .prepare(
      "SELECT * FROM email_jobs WHERE status='pending' AND next_attempt<=? ORDER BY id LIMIT 5",
    )
    .all(Date.now());
  for (const job of jobs) {
    if (
      !db
        .prepare(
          "UPDATE email_jobs SET status='sending',attempts=attempts+1 WHERE id=? AND status='pending'",
        )
        .run(job.id).changes
    )
      continue;
    try {
      const invoice = getInvoice(db, job.invoice_id);
      if (invoice.status === "void") {
        db.prepare(
          "UPDATE email_jobs SET status='cancelled',error='Invoice voided' WHERE id=?",
        ).run(job.id);
        continue;
      }
      const pdf = await makePdf(invoice);
      await mailer.transport.sendMail({
        from: mailer.from,
        to: job.recipient,
        replyTo: invoice.snapshot.landlord.email || undefined,
        messageId: `<rental-invoice-job-${job.id}-${invoice.number}@${mailer.from.match(/@([^>\s]+)/)?.[1] || "localhost"}>`,
        subject: `${invoice.number} — ${invoice.snapshot.landlord.name}`,
        text: `Hello ${invoice.snapshot.tenant.name},\n\nPlease find invoice ${invoice.number} attached.\nTotal: ${invoice.snapshot.landlord.currency} ${(invoice.total_cents / 100).toFixed(2)}\nDue: ${invoice.due_date}\n\n${invoice.snapshot.landlord.name}`,
        attachments: [
          {
            filename: `${invoice.number}.pdf`,
            content: pdf,
            contentType: "application/pdf",
          },
        ],
      });
      db.prepare(
        "UPDATE email_jobs SET status='sent',sent_at=CURRENT_TIMESTAMP,error='' WHERE id=?",
      ).run(job.id);
    } catch (error) {
      const attempts = job.attempts + 1;
      db.prepare(
        "UPDATE email_jobs SET status=?,next_attempt=?,error=? WHERE id=?",
      ).run(
        attempts >= 5 ? "failed" : "pending",
        Date.now() + Math.min(3600000, 60000 * 2 ** attempts),
        String(error.message).slice(0, 500),
        job.id,
      );
    }
  }
}
