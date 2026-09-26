export function sampleInvoice() {
  return {
    id: 1,
    number: "INV-R1-2627-0042",
    status: "issued",
    issue_date: "2026-09-01",
    due_date: "2026-09-07",
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    document_type: "tax_invoice",
    tax_mode: "cgst_sgst",
    reverse_charge: false,
    taxable_cents: 2925000,
    cgst_cents: 238500,
    sgst_cents: 238500,
    igst_cents: 0,
    tax_cents: 477000,
    total_cents: 3402000,
    paid_cents: 500000,
    balance_cents: 2902000,
    snapshot: {
      landlord: {
        name: "Patel Properties",
        address: "Tarsali Main Road\nVadodara, Gujarat 390009",
        email: "accounts@example.com",
        phone: "+91 90000 00000",
        tax_id: "PROPERTY-001",
        pan: "ABCDE1234F",
        gstin: "24ABCDE1234F1Z5",
        state: "Gujarat",
        state_code: "24",
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
        gstin: "24AAAAA0000A1Z5",
        state: "Gujarat",
        state_code: "24",
      },
      property: {
        name: "Tarsali Commercial",
        unit: "Ground floor",
        address: "Tarsali Main Road, Vadodara, Gujarat 390009",
        state: "Gujarat",
        state_code: "24",
      },
      gst: {
        document_type: "tax_invoice",
        tax_mode: "cgst_sgst",
        reverse_charge: false,
        place_of_supply: "Gujarat",
        place_of_supply_code: "24",
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
        sac_code: "997212",
        unit: "NOS",
        gst_rate: "18",
        cgst_cents: 225000,
        sgst_cents: 225000,
        igst_cents: 0,
        tax_cents: 450000,
        gross_cents: 2950000,
      },
      {
        title: "Electricity charges",
        description: "Meter consumption: 200 units.",
        category: "Electricity",
        quantity: "200",
        rate_cents: 875,
        amount_cents: 175000,
        sac_code: "2716",
        unit: "KWH",
        gst_rate: "0",
        cgst_cents: 0,
        sgst_cents: 0,
        igst_cents: 0,
        tax_cents: 0,
        gross_cents: 175000,
      },
      {
        title: "Monthly maintenance",
        description: "Common-area upkeep and building services.",
        category: "Maintenance",
        quantity: "1",
        rate_cents: 150000,
        amount_cents: 150000,
        sac_code: "998719",
        unit: "NOS",
        gst_rate: "18",
        cgst_cents: 13500,
        sgst_cents: 13500,
        igst_cents: 0,
        tax_cents: 27000,
        gross_cents: 177000,
      },
      {
        title: "Municipal property tax",
        description: "Agreed property tax contribution for September.",
        category: "Corporation tax",
        quantity: "1",
        rate_cents: 100000,
        amount_cents: 100000,
        sac_code: "999799",
        unit: "NOS",
        gst_rate: "0",
        cgst_cents: 0,
        sgst_cents: 0,
        igst_cents: 0,
        tax_cents: 0,
        gross_cents: 100000,
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
  invoice.taxable_cents = invoice.items.reduce((s, i) => s + i.amount_cents, 0);
  invoice.cgst_cents = invoice.items.reduce((s, i) => s + i.cgst_cents, 0);
  invoice.sgst_cents = invoice.items.reduce((s, i) => s + i.sgst_cents, 0);
  invoice.tax_cents = invoice.cgst_cents + invoice.sgst_cents;
  invoice.total_cents = invoice.taxable_cents + invoice.tax_cents;
  invoice.balance_cents = invoice.total_cents - invoice.paid_cents;
  invoice.notes =
    "Additional billing information and payment instructions. ".repeat(30) +
    "END_NOTES";
  return invoice;
}
