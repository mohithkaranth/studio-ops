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

function normalizeCell(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseDateInput(raw: string): string {
  const cleaned = raw.trim();

  const ddmmyyyy = cleaned.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (ddmmyyyy) return new Date(Date.UTC(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]))).toISOString().slice(0, 10);

  const ddMonyyyy = cleaned.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (ddMonyyyy) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = months.indexOf(ddMonyyyy[2].toLowerCase());
    if (monthIndex >= 0) return new Date(Date.UTC(Number(ddMonyyyy[3]), monthIndex, Number(ddMonyyyy[1]))).toISOString().slice(0, 10);
  }

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

function getCell(rows: string[][], rowIndex: number, colIndex: number): string | null {
  return normalizeCell(rows[rowIndex]?.[colIndex] ?? "") || null;
}

function parseAccountDetails(fullDetails: string | null): { accountName: string | null; accountNumber: string | null; currency: string | null } {
  if (!fullDetails) return { accountName: null, accountNumber: null, currency: null };
  const tokens = fullDetails.split(/\s+/).filter(Boolean);
  const currency = tokens.at(-1) ?? null;
  const accountNumberMatch = fullDetails.match(/\b\d{10}\b/);
  const accountNumber = accountNumberMatch?.[0] ?? null;
  let accountName: string | null = fullDetails;
  if (accountNumber) accountName = normalizeCell(fullDetails.replace(accountNumber, "").replace(new RegExp(`${currency ?? ""}$`), ""));
  return { accountName: accountName || null, accountNumber, currency };
}


export function parseBankStatementXls(fileName: string, buffer: Buffer): ParsedStatement {
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const latin1 = buffer.toString("latin1");
  const utf8 = buffer.toString("utf8");

  let rows: string[][] = [];
  if (/<table|<tr/i.test(latin1)) rows = parseHtmlRows(latin1);
  else if (/<Workbook|<Row|<Cell/i.test(utf8)) rows = parseXmlSpreadsheetRows(utf8);
  else rows = parseDelimitedRows(utf8);

  rows = rows.filter((row) => row.some(Boolean));

  const required = ["date", "value date", "transaction description 1", "transaction description 2", "debit", "credit", "running balance"];
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeCell(cell).toLowerCase());
    return required.every((name) => normalized.includes(name));
  });

  if (headerIndex < 0) {
    throw new Error("Transaction header row not found. Ensure the .xls contains columns: Date, Value Date, Transaction Description 1, Transaction Description 2, Debit, Credit, Running Balance.");
  }

  const header = rows[headerIndex].map((cell) => normalizeCell(cell).toLowerCase());
  const dateIndex = header.findIndex((cell) => cell === "date");
  const valueDateIndex = header.findIndex((cell) => cell === "value date");
  const desc1Index = header.findIndex((cell) => cell === "transaction description 1");
  const desc2Index = header.findIndex((cell) => cell === "transaction description 2");
  const debitIndex = header.findIndex((cell) => cell === "debit");
  const creditIndex = header.findIndex((cell) => cell === "credit");
  const runningBalanceIndex = header.findIndex((cell) => cell === "running balance");

  const transactions: ParsedTransaction[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const rawDate = normalizeCell(row[dateIndex] ?? "");
    if (!rawDate) break;

    let parsedDate: string;
    try {
      parsedDate = parseDateInput(rawDate);
    } catch {
      break;
    }

    transactions.push({
      transactionDate: parsedDate,
      valueDate: (() => { const v = normalizeCell(row[valueDateIndex] ?? ""); if (!v) return null; try { return parseDateInput(v); } catch { return null; } })(),
      description1: normalizeCell(row[desc1Index] ?? "") || null,
      description2: normalizeCell(row[desc2Index] ?? "") || null,
      debit: normalizeCell(row[debitIndex] ?? "") || null,
      credit: normalizeCell(row[creditIndex] ?? "") || null,
      runningBalance: normalizeCell(row[runningBalanceIndex] ?? "") || null,
      rawRow: JSON.stringify(row),
    });
  }

  const accountDetails = getCell(rows, 0, 1);
  const statementStartRaw = getCell(rows, 1, 1);
  const statementEndRaw = getCell(rows, 1, 3);
  const openingBalance = getCell(rows, 2, 1);
  const ledgerBalance = getCell(rows, 3, 1);
  const availableBalance = getCell(rows, 4, 1);

  if (!statementStartRaw || !statementEndRaw) throw new Error("Statement period metadata not found.");

  const { accountName, accountNumber, currency } = parseAccountDetails(accountDetails);

  return {
    fileHash,
    fileName,
    accountName,
    accountNumber,
    currency,
    statementStartDate: parseDateInput(statementStartRaw),
    statementEndDate: parseDateInput(statementEndRaw),
    openingBalance,
    ledgerBalance,
    availableBalance,
    printedBy: null,
    printedOn: null,
    transactions,
  };
}
