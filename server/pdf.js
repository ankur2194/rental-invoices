import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COLORS = {
  ink: "#203d36",
  muted: "#65786f",
  green: "#195749",
  line: "#dce5df",
  pale: "#f2f6f3",
  red: "#a5463c",
};
const categoryLabel = (value) =>
  value === "Corporation tax" ? "Municipal Property Tax" : value;
const documentLabel = (value) =>
  ({
    tax_invoice: "TAX INVOICE",
    bill_of_supply: "BILL OF SUPPLY",
    invoice: "INVOICE",
  })[value] || "INVOICE";
const displayDate = (value) => {
  const [year, month, day] = value.split("-");
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1]} ${year}`;
};
const smallNumbers = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const tens = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];
function underThousand(value) {
  const words = [];
  if (value >= 100) {
    words.push(`${smallNumbers[Math.floor(value / 100)]} Hundred`);
    value %= 100;
  }
  if (value >= 20) {
    words.push(tens[Math.floor(value / 10)]);
    value %= 10;
  }
  if (value) words.push(smallNumbers[value]);
  return words.join(" ");
}
function amountInWords(cents) {
  let value = Math.floor(cents / 100);
  const paise = cents % 100;
  const parts = [];
  for (const [divisor, label] of [
    [10000000, "Crore"],
    [100000, "Lakh"],
    [1000, "Thousand"],
  ]) {
    if (value >= divisor) {
      parts.push(`${underThousand(Math.floor(value / divisor))} ${label}`);
      value %= divisor;
    }
  }
  if (value) parts.push(underThousand(value));
  const rupees = parts.join(" ") || "Zero";
  return `Indian Rupees ${rupees}${paise ? ` and ${underThousand(paise)} Paise` : ""} Only`;
}

/** Shared by browser downloads and email attachments. All layout uses explicit
 * coordinates and measured lines, never PDFKit's mutable text-flow cursor. */
export function makePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      bufferPages: true,
      info: {
        Title: invoice.number,
        Author: invoice.snapshot.landlord.name,
        Subject: documentLabel(invoice.document_type),
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      const regular =
        process.env.PDF_FONT_REGULAR ||
        fileURLToPath(
          new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url),
        );
      const bold =
        process.env.PDF_FONT_BOLD ||
        fileURLToPath(
          new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url),
        );
      const fonts = {
        normal: existsSync(regular) ? regular : "Helvetica",
        bold: existsSync(bold) ? bold : "Helvetica-Bold",
      };
      const { landlord, tenant, property } = invoice.snapshot;
      const gst = invoice.snapshot.gst || {
        document_type: invoice.document_type || "invoice",
        tax_mode: invoice.tax_mode || "none",
        reverse_charge: !!invoice.reverse_charge,
        place_of_supply: property.state || "",
        place_of_supply_code: property.state_code || "",
      };
      const title = documentLabel(gst.document_type);
      const left = 32,
        right = doc.page.width - 32,
        width = right - left;
      const bottom = doc.page.height - 70;
      let y = 42;
      const amount = (cents) =>
        (cents / 100).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      const rate = (value) =>
        Number(value || 0).toLocaleString("en-IN", {
          maximumFractionDigits: 3,
        });
      const style = (size = 9, bold = false, color = COLORS.ink) => ({
        size,
        bold,
        color,
      });
      const apply = (s) =>
        doc
          .font(s.bold ? fonts.bold : fonts.normal)
          .fontSize(s.size)
          .fillColor(s.color);
      const lineHeight = (s) => {
        apply(s);
        return Math.ceil(doc.currentLineHeight(true)) + 2;
      };
      const text = (value, x, at, w, s = style(), align = "left") => {
        apply(s);
        doc.text(String(value), x, at, {
          width: w,
          align,
          lineBreak: false,
          characterSpacing: 0,
          wordSpacing: 0,
        });
      };
      const rule = (at) =>
        doc
          .strokeColor(COLORS.line)
          .lineWidth(0.6)
          .moveTo(left, at)
          .lineTo(right, at)
          .stroke();
      // Wrap by measured glyph widths, including very long unbroken identifiers.
      const wrap = (value, w, s = style()) => {
        apply(s);
        const lines = [];
        for (const paragraph of String(value || "")
          .replace(/\r\n?/g, "\n")
          .split("\n")) {
          if (!paragraph.trim()) {
            lines.push({ text: "", ...s, h: lineHeight(s) });
            continue;
          }
          let line = "";
          for (const word of paragraph.trim().split(/\s+/)) {
            apply(s);
            const candidate = line ? `${line} ${word}` : word;
            if (doc.widthOfString(candidate) <= w) {
              line = candidate;
              continue;
            }
            if (line) {
              lines.push({ text: line, ...s, h: lineHeight(s) });
              line = "";
            }
            for (const character of word) {
              apply(s);
              if (line && doc.widthOfString(line + character) > w) {
                lines.push({ text: line, ...s, h: lineHeight(s) });
                line = "";
              }
              line += character;
            }
          }
          if (line) lines.push({ text: line, ...s, h: lineHeight(s) });
        }
        return lines;
      };
      const compactHeader = () => {
        text(
          invoice.status === "void" ? `VOID ${title}` : title,
          left,
          35,
          220,
          style(13, true),
        );
        text(
          invoice.number,
          right - 250,
          38,
          250,
          style(9, false, COLORS.muted),
          "right",
        );
        rule(60);
        y = 77;
      };
      const newPage = () => {
        doc.addPage();
        compactHeader();
      };
      const ensure = (height) => {
        if (y + height > bottom) newPage();
      };
      const label = (value, x, at, w) =>
        text(value, x, at, w, style(8, true, COLORS.muted));
      const drawLines = (lines, x, w) => {
        for (const line of lines) {
          text(line.text, x, y, w, line);
          y += line.h;
        }
      };
      const stack = (parts, w) =>
        parts
          .filter((p) => p.value)
          .flatMap((p) => wrap(p.value, w, p.style || style()));
      // Branded heading and clear payable amount, independent of text length.
      text(
        invoice.status === "void" ? `VOID ${title}` : title,
        left,
        y,
        300,
        style(23, true),
      );
      text(invoice.number, left, 77, 300, style(11, false, COLORS.muted));
      const cardX = right - 184;
      doc.roundedRect(cardX, 38, 184, 61, 5).fill(COLORS.pale);
      label(
        invoice.status === "void"
          ? "CANCELLED - DO NOT PAY"
          : `BALANCE DUE (${landlord.currency})`,
        cardX + 12,
        49,
        160,
      );
      text(
        invoice.status === "void" ? "VOID" : amount(invoice.balance_cents),
        cardX + 12,
        67,
        160,
        style(18, true, invoice.status === "void" ? COLORS.red : COLORS.green),
        "right",
      );
      rule(104);
      y = 120;
      // Paired landlord / tenant columns can span pages without truncating data.
      const colWidth = (width - 30) / 2;
      const party = (person) =>
        stack(
          [
            { value: person.name, style: style(11, true) },
            { value: person.address },
            {
              value:
                person.state &&
                `${person.state}${person.state_code ? ` (${person.state_code})` : ""}`,
            },
            { value: person.gstin && `GSTIN: ${person.gstin}` },
            { value: person.pan && `PAN: ${person.pan}` },
            { value: person.email },
            { value: person.phone },
            {
              value:
                !person.gstin && person.tax_id
                  ? `Legacy tax ID: ${person.tax_id}`
                  : "",
            },
          ],
          colWidth,
        );
      const sender = party(landlord),
        recipient = party(tenant);
      let senderIndex = 0,
        recipientIndex = 0,
        continued = false;
      while (senderIndex < sender.length || recipientIndex < recipient.length) {
        ensure(55);
        label(
          continued ? "SUPPLIER (CONTINUED)" : "SUPPLIER / LANDLORD",
          left,
          y,
          colWidth,
        );
        label(
          continued ? "RECIPIENT (CONTINUED)" : "RECIPIENT / TENANT",
          left + colWidth + 30,
          y,
          colWidth,
        );
        y += 17;
        while (
          senderIndex < sender.length ||
          recipientIndex < recipient.length
        ) {
          const a = sender[senderIndex],
            b = recipient[recipientIndex],
            height = Math.max(a?.h || 0, b?.h || 0);
          if (y + height > bottom) break;
          if (a) {
            text(a.text, left, y, colWidth, a);
            senderIndex++;
          }
          if (b) {
            text(b.text, left + colWidth + 30, y, colWidth, b);
            recipientIndex++;
          }
          y += height;
        }
        if (senderIndex < sender.length || recipientIndex < recipient.length) {
          newPage();
          continued = true;
        }
      }
      y += 12;
      // An optional aside is drawn beside the first chunk of a section.
      const section = (heading, parts, aside) => {
        const asideW = aside ? aside.w + 16 : 0;
        const lines = stack(parts, width - 24 - asideW);
        let index = 0,
          continuation = false;
        while (index < lines.length) {
          const minH = aside && !continuation ? aside.h : 0;
          ensure(Math.max(21 + lines[index].h, minH) + 10);
          const start = y;
          let h = 21;
          let end = index;
          while (
            end < lines.length &&
            start + h + lines[end].h + 10 <= bottom
          ) {
            h += lines[end].h;
            end++;
          }
          h = Math.max(h, minH);
          doc.roundedRect(left, start, width, h + 10, 4).fill(COLORS.pale);
          label(
            heading + (continuation ? " (CONTINUED)" : ""),
            left + 12,
            start + 9,
            width - 24 - asideW,
          );
          if (aside && !continuation) aside.draw(right - 12 - aside.w, start);
          y = start + 21;
          drawLines(lines.slice(index, end), left + 12, width - 24 - asideW);
          y = start + h + 20;
          index = end;
          if (index < lines.length) {
            newPage();
            continuation = true;
          }
        }
      };
      // Equal-width boxes side by side; each column paginates independently.
      const sideBySide = (blocks) => {
        if (!blocks.length) return;
        if (blocks.length === 1)
          return section(blocks[0].heading, blocks[0].parts);
        const gap = 14,
          w = (width - gap * (blocks.length - 1)) / blocks.length;
        const cols = blocks.map((block, i) => ({
          ...block,
          x: left + i * (w + gap),
          lines: stack(block.parts, w - 24),
          index: 0,
        }));
        const remaining = () => cols.some((c) => c.index < c.lines.length);
        let continuation = false;
        while (remaining()) {
          ensure(31 + Math.max(...cols.map((c) => c.lines[c.index]?.h || 0)));
          const start = y;
          const chunks = cols.map((c) => {
            let h = 21,
              end = c.index;
            while (
              end < c.lines.length &&
              start + h + c.lines[end].h + 10 <= bottom
            ) {
              h += c.lines[end].h;
              end++;
            }
            return { h, end };
          });
          const h = Math.max(...chunks.map((chunk) => chunk.h));
          cols.forEach((c, i) => {
            if (continuation && c.index >= c.lines.length) return;
            doc.roundedRect(c.x, start, w, h + 10, 4).fill(COLORS.pale);
            label(
              c.heading + (continuation ? " (CONTINUED)" : ""),
              c.x + 12,
              start + 9,
              w - 24,
            );
            y = start + 21;
            drawLines(c.lines.slice(c.index, chunks[i].end), c.x + 12, w - 24);
            c.index = chunks[i].end;
          });
          y = start + h + 20;
          if (remaining()) {
            newPage();
            continuation = true;
          }
        }
      };
      const datesW = 150;
      section(
        "PROPERTY",
        [
          {
            value: [property.name, property.unit].filter(Boolean).join(" / "),
            style: style(10, true),
          },
          { value: property.address },
          {
            value:
              property.state &&
              `${property.state}${property.state_code ? ` (${property.state_code})` : ""}`,
          },
          {
            value: `Place of supply: ${gst.place_of_supply || "Not specified"}${gst.place_of_supply_code ? ` (${gst.place_of_supply_code})` : ""} · Reverse charge: ${gst.reverse_charge ? "Yes" : "No"}`,
          },
        ],
        {
          w: datesW,
          h: 54,
          draw: (x, top) => {
            doc
              .strokeColor(COLORS.line)
              .lineWidth(0.6)
              .moveTo(x - 8, top + 9)
              .lineTo(x - 8, top + 54)
              .stroke();
            [
              ["ISSUE DATE", invoice.issue_date, top + 9],
              ["DUE DATE", invoice.due_date, top + 34],
            ].forEach(([title, value, at]) => {
              text(title, x, at, datesW, style(8, true, COLORS.muted), "right");
              text(
                displayDate(value),
                x,
                at + 12,
                datesW,
                style(9, true),
                "right",
              );
            });
          },
        },
      );
      // Fixed-width table columns and repeated header on each page of items.
      const columns = [
        { w: 165, title: "DESCRIPTION" },
        { w: 46, title: "SAC/HSN" },
        { w: 50, title: "QTY" },
        { w: 62, title: "RATE" },
        { w: 66, title: "TAXABLE" },
        { w: 72, title: "GST" },
        { title: "TOTAL" },
      ];
      columns.at(-1).w =
        width - columns.slice(0, -1).reduce((sum, c) => sum + c.w, 0);
      let columnX = left;
      for (const column of columns) {
        column.x = columnX;
        columnX += column.w;
      }
      const headerHeight = 24;
      const tableHeader = () => {
        doc.rect(left, y, width, headerHeight).fill(COLORS.green);
        columns.forEach((c, i) =>
          text(
            c.title,
            c.x + 3,
            y + 8,
            c.w - 6,
            style(6.5, true, "#ffffff"),
            i ? "right" : "left",
          ),
        );
        y += headerHeight;
      };
      // Keep a value inside its fixed column by shrinking only as a last resort.
      const cell = (value, c, at, s) => {
        let size = s.size;
        apply({ ...s, size });
        while (doc.widthOfString(value) > c.w - 6 && size > 5) {
          size -= 0.25;
          apply({ ...s, size });
        }
        text(value, c.x + 3, at, c.w - 6, { ...s, size }, "right");
      };
      ensure(80);
      tableHeader();
      for (const [index, item] of invoice.items.entries()) {
        const lines = stack(
          [
            { value: item.title, style: style(9, true) },
            { value: item.description, style: style(8.5, false, COLORS.muted) },
            {
              value: !item.description ? categoryLabel(item.category) : "",
              style: style(8, false, COLORS.muted),
            },
          ],
          columns[0].w - 18,
        );
        const fullHeight = lines.reduce((sum, l) => sum + l.h, 0) + 14;
        const freshCapacity = bottom - 77 - headerHeight;
        if (y + Math.min(fullHeight, freshCapacity) > bottom) {
          newPage();
          tableHeader();
        }
        let indexLine = 0,
          continuation = false;
        while (indexLine < lines.length) {
          const markerHeight = continuation ? 15 : 0;
          if (y + markerHeight + lines[indexLine].h + 14 > bottom) {
            newPage();
            tableHeader();
          }
          const start = y;
          let height = 7 + markerHeight,
            end = indexLine;
          while (
            end < lines.length &&
            start + height + lines[end].h + 10 <= bottom
          ) {
            height += lines[end].h;
            end++;
          }
          height = Math.max(height + 7, continuation ? 0 : 30);
          if (index % 2 === 0)
            doc.rect(left, start, width, height).fill("#f8faf8");
          y = start + 7;
          if (continuation) {
            text(
              "Item continued",
              left + 9,
              y,
              columns[0].w - 18,
              style(8, false, COLORS.muted),
            );
            y += 15;
          }
          drawLines(lines.slice(indexLine, end), left + 9, columns[0].w - 18);
          if (!continuation) {
            const taxRate =
              gst.tax_mode === "cgst_sgst" && Number(item.gst_rate)
                ? `C ${rate(Number(item.gst_rate) / 2)}% + S ${rate(Number(item.gst_rate) / 2)}%`
                : gst.tax_mode === "igst" && Number(item.gst_rate)
                  ? `IGST ${rate(item.gst_rate)}%`
                  : "0%";
            const [, sac, qty, unitRate, taxable, tax, total] = columns;
            const at = start + 7;
            cell(item.sac_code || "-", sac, at, style(7.5));
            cell(String(item.quantity), qty, at, style(7.5));
            cell(
              item.unit || "-",
              qty,
              at + 11,
              style(6.5, false, COLORS.muted),
            );
            cell(amount(item.rate_cents), unitRate, at, style(7.5));
            cell(amount(item.amount_cents), taxable, at, style(7.5));
            cell(amount(item.tax_cents || 0), tax, at, style(7.5));
            cell(taxRate, tax, at + 11, style(6.5, false, COLORS.muted));
            cell(
              amount(item.gross_cents ?? item.amount_cents),
              total,
              at,
              style(7.5, true),
            );
          }
          y = start + height;
          rule(y);
          indexLine = end;
          continuation = true;
          if (indexLine < lines.length) {
            newPage();
            tableHeader();
          }
        }
      }
      const taxableCents =
        invoice.taxable_cents ??
        invoice.items.reduce((sum, item) => sum + item.amount_cents, 0);
      const cgstCents = invoice.cgst_cents || 0;
      const sgstCents = invoice.sgst_cents || 0;
      const igstCents = invoice.igst_cents || 0;
      const summaryRows = [
        ["Taxable value", taxableCents],
        ...(gst.tax_mode === "cgst_sgst"
          ? [
              ["CGST", cgstCents],
              ["SGST", sgstCents],
            ]
          : []),
        ...(gst.tax_mode === "igst" ? [["IGST", igstCents]] : []),
        ["Invoice total", invoice.total_cents],
        ["Payments received", invoice.paid_cents],
      ];
      // Amount in words is bottom-aligned with the balance box.
      const rowHeight = 16,
        balanceHeight = 28;
      const totalW = 240,
        totalX = right - totalW;
      const wordsW = totalX - left - 16;
      const words = wrap(
        amountInWords(invoice.total_cents),
        wordsW - 24,
        style(9, true),
      );
      const wordsHeight = words.reduce((sum, l) => sum + l.h, 0) + 31;
      const summaryHeight = summaryRows.length * rowHeight + 3 + balanceHeight;
      y += 12;
      ensure(Math.max(summaryHeight, wordsHeight) + 12);
      const summaryTop = y + Math.max(0, wordsHeight - summaryHeight),
        summaryBottom = summaryTop + summaryHeight;
      summaryRows.forEach(([title, value], index) => {
        const at = summaryTop + index * rowHeight;
        const strong = title === "Invoice total";
        text(title, totalX + 12, at, 110, style(8.5, strong));
        text(
          `${landlord.currency} ${amount(value)}`,
          totalX + 110,
          at,
          totalW - 122,
          style(8.5, strong),
          "right",
        );
      });
      const balanceY = summaryBottom - balanceHeight;
      doc
        .roundedRect(totalX, balanceY, totalW, balanceHeight, 4)
        .fill(COLORS.green);
      text(
        invoice.status === "void" ? "Balance (void)" : "Balance due",
        totalX + 12,
        balanceY + 8,
        98,
        style(9, true, "#ffffff"),
      );
      text(
        `${landlord.currency} ${amount(invoice.balance_cents)}`,
        totalX + 110,
        balanceY + 8,
        totalW - 122,
        style(9, true, "#ffffff"),
        "right",
      );
      const wordsY = summaryBottom - wordsHeight;
      doc.roundedRect(left, wordsY, wordsW, wordsHeight, 4).fill(COLORS.pale);
      label("AMOUNT IN WORDS", left + 12, wordsY + 9, wordsW - 24);
      y = wordsY + 21;
      drawLines(words, left + 12, wordsW - 24);
      y = summaryBottom + 12;
      const notes = [invoice.notes, landlord.notes].filter(Boolean).join("\n");
      sideBySide(
        [
          invoice.status === "void"
            ? {
                heading: "VOID INVOICE",
                parts: [
                  {
                    value:
                      "This invoice has been cancelled. No payment is requested.",
                  },
                ],
              }
            : landlord.payment_details && {
                heading: "PAYMENT DETAILS",
                parts: [{ value: landlord.payment_details }],
              },
          notes && { heading: "NOTES", parts: [{ value: notes }] },
        ].filter(Boolean),
      );
      // Footer space is reserved explicitly on every page.
      const { count } = doc.bufferedPageRange();
      for (let page = 0; page < count; page++) {
        doc.switchToPage(page);
        const foot = doc.page.height - 55;
        rule(foot - 11);
        text(
          invoice.number,
          left,
          foot,
          width - 90,
          style(8, false, COLORS.muted),
        );
        if (page === count - 1)
          text(
            "This is a computer-generated invoice and does not require a signature.",
            left + 110,
            foot + 0.5,
            width - 220,
            style(7, false, COLORS.muted),
            "center",
          );
        text(
          `Page ${page + 1} of ${count}`,
          right - 90,
          foot,
          90,
          style(8, false, COLORS.muted),
          "right",
        );
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}
