export function sampleInvoice() {
  return {
    id: 1,
    number: "INV-2026-00042",
    status: "issued",
    issue_date: "2026-09-01",
    due_date: "2026-09-07",
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    total_cents: 2925000,
    paid_cents: 500000,
    balance_cents: 2425000,
    snapshot: {
      landlord: {
        name: "Patel Properties",
        address: "Tarsali Main Road\nVadodara, Gujarat 390009",
        email: "accounts@example.com",
        phone: "+91 90000 00000",
        tax_id: "PROPERTY-001",
        currency: "INR",
        payment_details:
          "Bank: Example Bank\nAccount: 1234567890 | IFSC: EXAM0001234\nUse the invoice number as payment reference.",
        notes: "Thank you. Please pay by the due date.",
      },
      tenant: {
        name: "Acme Services Pvt. Ltd.",
        address: "Ground Floor, Tarsali Commercial\nVadodara, Gujarat 390009",
        email: "tenant@example.com",
        phone: "+91 91111 11111",
        tax_id: "TENANT-001",
      },
      property: {
        name: "Tarsali Commercial",
        unit: "Ground floor",
        address: "Tarsali Main Road, Vadodara, Gujarat 390009",
      },
    },
    items: [
      {
        title: "Rent for September 2026",
        description: "Monthly rent for the ground-floor commercial unit.",
        category: "Rent",
        quantity: "1",
        rate_cents: 2500000,
        amount_cents: 2500000,
      },
      {
        title: "Electricity charges",
        description: "Meter consumption: 200 units.",
        category: "Electricity",
        quantity: "200",
        rate_cents: 875,
        amount_cents: 175000,
      },
      {
        title: "Monthly maintenance",
        description: "Common-area upkeep and building services.",
        category: "Maintenance",
        quantity: "1",
        rate_cents: 150000,
        amount_cents: 150000,
      },
      {
        title: "Municipal property tax",
        description: "Agreed property tax contribution for September.",
        category: "Corporation tax",
        quantity: "1",
        rate_cents: 100000,
        amount_cents: 100000,
      },
    ],
    notes: "",
  };
}
export function longInvoice() {
  const invoice = sampleInvoice();
  invoice.items = Array.from({ length: 16 }, (_, i) => ({
    ...invoice.items[i % 4],
    title: `Item ${i + 1}: ${invoice.items[i % 4].title}`,
    description:
      "Detailed charge for the rental property. This description must wrap inside its own column without touching the quantity or amount. ".repeat(
        3,
      ) + `END_ITEM_${i + 1}`,
  }));
  invoice.total_cents = invoice.items.reduce((s, i) => s + i.amount_cents, 0);
  invoice.balance_cents = invoice.total_cents - invoice.paid_cents;
  invoice.notes =
    "Additional billing information and payment instructions. ".repeat(30) +
    "END_NOTES";
  return invoice;
}
