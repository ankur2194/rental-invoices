import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
const regular =
  process.env.PDF_FONT_REGULAR ||
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const bold =
  process.env.PDF_FONT_BOLD ||
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
export function makePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: invoice.number, Author: invoice.snapshot.landlord.name },
    });
    const chunks = [];
    doc.on("data", (x) => chunks.push(x));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const font = existsSync(regular) ? regular : "Helvetica";
    const strong = existsSync(bold) ? bold : "Helvetica-Bold";
    const { landlord, tenant, property } = invoice.snapshot;
    const money = (amount) =>
      `${landlord.currency} ${(amount / 100).toFixed(2)}`;
    const width = 499;
    const write = (text, size = 10, color = "#334155") => {
      doc
        .font(font)
        .fontSize(size)
        .fillColor(color)
        .text(String(text || ""), 48, doc.y, { width, lineGap: 3 });
    };
    const heading = (text) => {
      doc.moveDown(0.6);
      doc
        .font(strong)
        .fontSize(10)
        .fillColor("#0f766e")
        .text(text, 48, doc.y, { width });
      doc.moveDown(0.3);
    };
    doc
      .font(strong)
      .fontSize(25)
      .fillColor("#123d37")
      .text(invoice.status === "void" ? "VOID INVOICE" : "INVOICE");
    write(invoice.number, 12);
    doc.moveDown();
    heading("FROM");
    write(landlord.name, 13);
    write(landlord.address);
    write([landlord.email, landlord.phone].filter(Boolean).join(" · "));
    if (landlord.tax_id) write(`Tax ID: ${landlord.tax_id}`);
    heading("BILL TO");
    write(tenant.name, 13);
    write(tenant.address);
    if (tenant.email) write(tenant.email);
    if (tenant.tax_id) write(`Tax ID: ${tenant.tax_id}`);
    heading("PROPERTY");
    write(`${property.name}${property.unit ? " / " + property.unit : ""}`);
    write(property.address);
    doc.moveDown();
    write(`Issued: ${invoice.issue_date}    Due: ${invoice.due_date}`);
    write(`Billing period: ${invoice.period_start} to ${invoice.period_end}`);
    heading("CHARGES");
    for (const item of invoice.items) {
      const needed =
        doc
          .font(font)
          .fontSize(10)
          .heightOfString(`${item.title}\n${item.description}`, {
            width: 330,
          }) + 42;
      if (doc.y + needed > 740) doc.addPage();
      const y = doc.y;
      doc
        .font(strong)
        .fontSize(10)
        .fillColor("#172e2a")
        .text(item.title, 48, y, { width: 330 });
      doc
        .font(font)
        .fontSize(10)
        .text(money(item.amount_cents), 390, y, { width: 157, align: "right" });
      doc.y =
        y +
        doc
          .font(strong)
          .fontSize(10)
          .heightOfString(item.title, { width: 330 }) +
        4;
      if (item.description) write(item.description, 9);
      write(
        `${item.category} · ${item.quantity} × ${money(item.rate_cents)}`,
        9,
        "#64748b",
      );
      doc.moveDown(0.5);
      doc.strokeColor("#e2e8f0").moveTo(48, doc.y).lineTo(547, doc.y).stroke();
      doc.moveDown(0.5);
    }
    if (doc.y > 630) doc.addPage();
    heading("TOTAL");
    write(money(invoice.total_cents), 19, "#123d37");
    write(`Payments received: ${money(invoice.paid_cents)}`);
    write(`Balance: ${money(invoice.balance_cents)}`, 12);
    if (landlord.payment_details) {
      heading("PAYMENT DETAILS");
      write(landlord.payment_details);
    }
    if (invoice.notes || landlord.notes) {
      heading("NOTES");
      write([invoice.notes, landlord.notes].filter(Boolean).join("\n"));
    }
    doc.end();
  });
}
