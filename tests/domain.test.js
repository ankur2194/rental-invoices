import test from "node:test";
import assert from "node:assert/strict";
import {
  nextOccurrence,
  periodFor,
  renderTemplate,
  cents,
  calculateItems,
  date,
} from "../server/domain.js";

test("month-end anchors recover after February", () => {
  const feb = nextOccurrence("2025-01-31", "monthly", "2025-01-31");
  assert.equal(feb, "2025-02-28");
  assert.equal(nextOccurrence(feb, "monthly", "2025-01-31"), "2025-03-31");
  assert.equal(
    nextOccurrence("2024-01-31", "monthly", "2024-01-31"),
    "2024-02-29",
  );
});
test("yearly leap day returns on the next leap year", () => {
  let date = "2024-02-29";
  for (let i = 0; i < 4; i++)
    date = nextOccurrence(date, "yearly", "2024-02-29");
  assert.equal(date, "2028-02-29");
});
test("weekly periods cross year boundaries", () =>
  assert.deepEqual(periodFor("2025-12-29", "weekly", "2025-12-29"), {
    period_start: "2025-12-29",
    period_end: "2026-01-04",
  }));
test("template tokens use billing period and reject typos", () => {
  assert.equal(
    renderTemplate(
      "Rent {month} {year} ({period_start} to {period_end}) for {tenant}",
      {
        period_start: "2026-02-01",
        period_end: "2026-02-28",
        issue_date: "2026-01-25",
        tenant: "Asha",
      },
    ),
    "Rent February 2026 (2026-02-01 to 2026-02-28) for Asha",
  );
  assert.throws(
    () => renderTemplate("{mont}", { period_start: "2026-01-01" }),
    /Unknown template/,
  );
});
test("money uses cents and fractional quantities round per item", () => {
  assert.equal(cents("19.99"), 1999);
  assert.equal(cents("0.10"), 10);
  assert.throws(() => cents("12.345"));
  assert.throws(() => cents("-1"));
  assert.equal(
    calculateItems([
      {
        title: "Electricity",
        category: "Electricity",
        quantity: "123.456",
        rate: "8.75",
      },
    ]).total_cents,
    108024,
  );
  assert.throws(
    () => calculateItems([{ title: "Test", quantity: "1", rate: "0" }]),
    /positive/,
  );
});
test("invalid calendar dates are rejected", () => {
  assert.throws(() => date.parse("2026-02-30"));
  assert.throws(() => date.parse("2026-13-01"));
  assert.equal(date.parse("2024-02-29"), "2024-02-29");
});

test("legacy corporation-tax categories normalize without breaking saved schedules", () => {
  const item = {
    title: "Tax contribution",
    quantity: "1",
    rate: "1000",
    category: "Corporation tax",
  };
  const old = calculateItems([item]);
  const current = calculateItems([
    { ...item, category: "Municipal Property Tax" },
  ]);
  assert.equal(old.items[0].category, "Municipal Property Tax");
  assert.deepEqual(old, current);
});
