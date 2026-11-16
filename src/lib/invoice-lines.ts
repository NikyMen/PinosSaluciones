export type InvoiceLine = {
  stockItemId?: string;
  description: string;
  quantity: number;
  unit: string;
  unitCents: number;
};

export function invoiceLineCents(line: InvoiceLine) {
  return Math.round(line.quantity * line.unitCents);
}

export function invoiceLinesGrossCents(lines: InvoiceLine[]) {
  return lines.reduce((sum, line) => sum + invoiceLineCents(line), 0);
}

export function invoicePrintLines(invoice: Record<string, unknown>): InvoiceLine[] {
  return Array.isArray(invoice.lines) ? invoice.lines as InvoiceLine[] : [];
}
