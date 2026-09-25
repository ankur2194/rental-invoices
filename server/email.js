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
export async function processEmailJobs(db, mailer, logger) {
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
    logger?.info(
      {
        emailJobId: job.id,
        invoiceId: job.invoice_id,
        recipient: job.recipient,
      },
      "Sending invoice email",
    );
    try {
      const invoice = getInvoice(db, job.invoice_id);
      if (invoice.status === "void") {
        db.prepare(
          "UPDATE email_jobs SET status='cancelled',error='Invoice voided' WHERE id=?",
        ).run(job.id);
        logger?.info(
          { emailJobId: job.id, invoiceId: job.invoice_id },
          "Invoice email cancelled: invoice voided",
        );
        continue;
      }
      const pdf = await makePdf(invoice);
      const result = await mailer.transport.sendMail({
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
      // SMTP acceptance means the provider took responsibility for delivery;
      // it does not mean the message reached the recipient's inbox.
      if (
        Array.isArray(result?.accepted) &&
        !result.accepted.some(
          (address) => address.toLowerCase() === job.recipient.toLowerCase(),
        )
      )
        throw new Error("SMTP did not accept the recipient");
      db.prepare(
        "UPDATE email_jobs SET status='sent',sent_at=CURRENT_TIMESTAMP,error='' WHERE id=?",
      ).run(job.id);
      logger?.info(
        {
          emailJobId: job.id,
          invoice: invoice.number,
          recipient: job.recipient,
          messageId: result?.messageId,
          smtpResponse: result?.response?.slice(0, 300),
        },
        "Invoice email accepted by SMTP (inbox delivery unconfirmed)",
      );
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
      logger?.warn(
        {
          emailJobId: job.id,
          invoiceId: job.invoice_id,
          recipient: job.recipient,
          attempt: attempts,
          error: String(error.message).slice(0, 500),
        },
        "Invoice email delivery attempt failed",
      );
    }
  }
}
