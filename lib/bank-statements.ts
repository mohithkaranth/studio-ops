import crypto from "node:crypto";

export type ParsedTransaction = {
  transactionDate: string;
  valueDate: string | null;
  description1: string | null;
  description2: string | null;
  debit: string | null;
  credit: string | null;
  runningBalance: string | null;
  rawRow: string;
};

export type ParsedStatement = {
  fileHash: string;
  fileName: string;
  accountName: string | null;
  accountNumber: string | null;
  currency: string | null;
  statementStartDate: string;
  statementEndDate: string;
  openingBalance: string | null;
  ledgerBalance: string | null;
  availableBalance: string | null;
  printedBy: string | null;
  printedOn: string | null;
  transactions: ParsedTransaction[];
};

const headerColumns = [
  "date",
  "value date",
  "transaction description 1",
  "transaction description 2",
  "debit",
  "credit",
  "running balance",
];

function normalizeCell(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseDateInput(raw: string): string {
  const cleaned = raw.trim();
  const ddmmyyyy = cleaned.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  }

  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  throw new Error(`Unable to parse date: ${raw}`);
}

function parseHtmlTableRows(content: string): string[][] {
  const rows = [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.map((row) => {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      normalizeCell(
        cell[1]
          .replace(/<br\s*\/?\s*>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&"),
      ),
    );
    return cells;
  });
}

function findMetadata(content: string, label: string): string | null {
  const match = content.match(new RegExp(`${label}\\s*:?\\s*</?[^>]*>?\\s*([^\\r\\n<]+)`, "i"));
  return match ? normalizeCell(match[1]) : null;
}

export function parseBankStatementXls(fileName: string, buffer: Buffer): ParsedStatement {
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const content = buffer.toString("latin1");

  if (!/<table|<tr/i.test(content)) {
    throw new Error("Unsupported .xls format. Expected HTML-based Excel export.");
  }

  const rows = parseHtmlTableRows(content).filter((row) => row.some(Boolean));

  const headerIndex = rows.findIndex((row) =>
    headerColumns.every((column, index) => normalizeCell(row[index] ?? "").toLowerCase() === column),
  );

  if (headerIndex < 0) {
    throw new Error("Transaction header row not found.");
  }

  const txRows = rows.slice(headerIndex + 1);
  const transactions: ParsedTransaction[] = [];

  for (const row of txRows) {
    if (!row[0] || !/\d/.test(row[0])) {
      continue;
    }

    transactions.push({
      transactionDate: parseDateInput(row[0]),
      valueDate: row[1] ? parseDateInput(row[1]) : null,
      description1: row[2] || null,
      description2: row[3] || null,
      debit: row[4] || null,
      credit: row[5] || null,
      runningBalance: row[6] || null,
      rawRow: JSON.stringify(row),
    });
  }

  const statementStartRaw = findMetadata(content, "Statement From");
  const statementEndRaw = findMetadata(content, "Statement To");

  if (!statementStartRaw || !statementEndRaw) {
    throw new Error("Statement period metadata not found.");
  }

  return {
    fileHash,
    fileName,
    accountName: findMetadata(content, "Account Details"),
    accountNumber: findMetadata(content, "Account Number"),
    currency: findMetadata(content, "Currency"),
    statementStartDate: parseDateInput(statementStartRaw),
    statementEndDate: parseDateInput(statementEndRaw),
    openingBalance: findMetadata(content, "Opening Balance"),
    ledgerBalance: findMetadata(content, "Ledger Balance"),
    availableBalance: findMetadata(content, "Available Balance"),
    printedBy: findMetadata(content, "Printed By"),
    printedOn: findMetadata(content, "Printed On"),
    transactions,
  };
}
