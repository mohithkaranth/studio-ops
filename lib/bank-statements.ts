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

const headerColumns = ["date", "value date", "transaction description 1", "transaction description 2", "debit", "credit", "running balance"];

function normalizeCell(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseDateInput(raw: string): string {
  const cleaned = raw.trim();
  const ddmmyyyy = cleaned.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (ddmmyyyy) return new Date(Date.UTC(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]))).toISOString().slice(0, 10);
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  throw new Error(`Unable to parse date: ${raw}`);
}

function parseHtmlRows(content: string): string[][] {
  return [...content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      normalizeCell(cell[1].replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")),
    ),
  );
}

function parseXmlSpreadsheetRows(content: string): string[][] {
  return [...content.matchAll(/<Row[^>]*>([\s\S]*?)<\/Row>/gi)].map((row) =>
    [...row[1].matchAll(/<Cell[^>]*>([\s\S]*?)<\/Cell>/gi)].map((cell) => {
      const data = cell[1].match(/<Data[^>]*>([\s\S]*?)<\/Data>/i)?.[1] ?? "";
      return normalizeCell(data.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"));
    }),
  );
}

function parseDelimitedRows(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,/).map((value) => normalizeCell(value.replace(/^"|"$/g, ""))));
}

function findHeaderIndex(rows: string[][]): number {
  return rows.findIndex((row) => headerColumns.every((column, idx) => normalizeCell(row[idx] ?? "").toLowerCase() === column));
}

function findMetadataInRows(rows: string[][], label: string): string | null {
  const lower = label.toLowerCase();
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      if (normalizeCell(row[i]).toLowerCase() === lower || normalizeCell(row[i]).toLowerCase() === `${lower}:`) {
        return normalizeCell(row[i + 1] ?? "") || null;
      }
    }
  }
  return null;
}

export function parseBankStatementXls(fileName: string, buffer: Buffer): ParsedStatement {
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const latin1 = buffer.toString("latin1");
  const utf8 = buffer.toString("utf8");

  let rows: string[][] = [];
  if (/<table|<tr/i.test(latin1)) {
    rows = parseHtmlRows(latin1);
  } else if (/<Workbook|<Row|<Cell/i.test(utf8)) {
    rows = parseXmlSpreadsheetRows(utf8);
  } else {
    rows = parseDelimitedRows(utf8);
  }

  rows = rows.filter((row) => row.some(Boolean));
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) {
    throw new Error("Transaction header row not found. Ensure the .xls contains columns: Date, Value Date, Transaction Description 1, Transaction Description 2, Debit, Credit, Running Balance.");
  }

  const transactions: ParsedTransaction[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row[0]) continue;
    try {
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
    } catch {
      continue;
    }
  }

  const statementStartRaw = findMetadataInRows(rows, "Statement From");
  const statementEndRaw = findMetadataInRows(rows, "Statement To");
  if (!statementStartRaw || !statementEndRaw) throw new Error("Statement period metadata not found.");

  return {
    fileHash,
    fileName,
    accountName: findMetadataInRows(rows, "Account Details"),
    accountNumber: findMetadataInRows(rows, "Account Number"),
    currency: findMetadataInRows(rows, "Currency"),
    statementStartDate: parseDateInput(statementStartRaw),
    statementEndDate: parseDateInput(statementEndRaw),
    openingBalance: findMetadataInRows(rows, "Opening Balance"),
    ledgerBalance: findMetadataInRows(rows, "Ledger Balance"),
    availableBalance: findMetadataInRows(rows, "Available Balance"),
    printedBy: findMetadataInRows(rows, "Printed By"),
    printedOn: findMetadataInRows(rows, "Printed On"),
    transactions,
  };
}
