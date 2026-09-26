import test from "node:test";
import assert from "node:assert/strict";
import { makePdf } from "../server/pdf.js";
import { sampleInvoice, longInvoice } from "./pdf-fixtures.js";
const pageCount = (buffer) =>
  [...buffer.toString("latin1").matchAll(/\/Type \/Page\b/g)].length;

test("ordinary GST invoice stays compact and embeds bundled fonts", async () => {
  const invoice = sampleInvoice();
  const before = JSON.stringify(invoice);
  const pdf = await makePdf(invoice);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(
    pageCount(pdf),
    1,
    "A typical GST invoice must fit on a single page",
  );
  assert.match(
    pdf.toString("latin1"),
    /\/FontFile2/,
    "Fonts must be embedded for portable rendering",
  );
  assert.match(pdf.toString("latin1"), /DejaVuSans/);
  assert.equal(
    JSON.stringify(invoice),
    before,
    "Rendering must not mutate historical invoice data",
  );
});
test("long multi-page invoices paginate within a bounded page count", async () => {
  const pdf = await makePdf(longInvoice());
  assert.ok(pageCount(pdf) >= 3);
  assert.ok(
    pageCount(pdf) <= 10,
    "Avoid extra pages from cursor or footer overflow",
  );
});
test("oversized descriptions and notes split across pages without hanging", async () => {
  const invoice = sampleInvoice();
  invoice.items = [
    {
      ...invoice.items[0],
      description: "X".repeat(2000),
      title: "Long item title ".repeat(13),
      quantity: "99999.999",
    },
  ];
  invoice.snapshot.landlord.address = "Long address line\n".repeat(75);
  invoice.snapshot.landlord.payment_details = "Payment instructions ".repeat(
    95,
  );
  invoice.notes = "Invoice notes ".repeat(140);
  const pdf = await makePdf(invoice);
  assert.ok(pageCount(pdf) >= 3);
  assert.ok(pageCount(pdf) <= 9);
});
test("void invoices still export as valid PDFs", async () => {
  const pdf = await makePdf({ ...sampleInvoice(), status: "void" });
  assert.equal(pageCount(pdf), 1);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});
