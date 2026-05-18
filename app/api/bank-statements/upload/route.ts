import { NextResponse } from "next/server";
import crypto from "crypto";
import * as XLSX from "xlsx";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type ParsedTransaction = {
  transaction_date: string;
  value_date: string | null;
  description_1: string | null;
  description_2: string | null;
  debit: number | null;
  credit: number | null;
  running_balance: number | null;
  raw_row: Record<string, unknown>;
  row_hash: string;
};

function cleanCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(value: unknown): number | null {
  const text = cleanCell(value).replace(/,/g, "");
  if (!text) return null;

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = cleanCell(value);
  if (!text) return null;

  const match = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;

  const [, day, monthText, year] = match;

  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };

  const month = months[monthText.toLowerCase()];
  if (!month) return null;

  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function extractAccountDetails(accountDetails: string) {
  const cleaned = cleanCell(accountDetails);
  const accountNumberMatch = cleaned.match(/\b\d{10}\b/);
  const currencyMatch = cleaned.match(/\b[A-Z]{3}\b$/);

  const account_number = accountNumberMatch?.[0] ?? null;
  const currency = currencyMatch?.[0] ?? "SGD";

  let account_name = cleaned;

  if (account_number) {
    account_name = account_name.replace(account_number, "");
  }

  if (currency) {
    account_name = account_name.replace(new RegExp(`\\b${currency}\\b$`), "");
  }

  account_name = cleanCell(account_name);

  return {
    account_name,
    account_number,
    currency,
  };
}

function parseWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
  });

  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("No sheet found in uploaded file.");
  }

  const sheet = workbook.Sheets[firstSheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];

  const normalizedRows = rows.map((row) => row.map(cleanCell));

  const accountRow = normalizedRows.find((row) =>
    row.some((cell) => cell.toLowerCase().startsWith("account details")),
  );

  const statementRow = normalizedRows.find((row) =>
    row.some((cell) => cell.toLowerCase().startsWith("statement as at")),
  );

  const openingBalanceRow = normalizedRows.find((row) =>
    row.some((cell) => cell.toLowerCase().startsWith("opening balance")),
  );

  const ledgerBalanceRow = normalizedRows.find((row) =>
    row.some((cell) => cell.toLowerCase().startsWith("ledger balance")),
  );

  const availableBalanceRow = normalizedRows.find((row) =>
    row.some((cell) => cell.toLowerCase().startsWith("available balance")),
  );

  if (!accountRow || !statementRow) {
    throw new Error("Statement header not found.");
  }

  const accountDetails = accountRow[1] ?? "";
  const { account_name, account_number, currency } =
    extractAccountDetails(accountDetails);

  const statement_start_date = parseDate(statementRow[1]);
  const statement_end_date = parseDate(statementRow[3]);

  if (!statement_start_date || !statement_end_date) {
    throw new Error("Statement period not found.");
  }

  const requiredHeaders = [
    "date",
    "value date",
    "transaction description 1",
    "transaction description 2",
    "debit",
    "credit",
    "running balance",
  ];

  const headerRowIndex = normalizedRows.findIndex((row) => {
    const headers = row.map((cell) => cell.toLowerCase());
    return requiredHeaders.every((header) => headers.includes(header));
  });

  if (headerRowIndex === -1) {
    throw new Error(
      `Transaction header row not found. First rows: ${JSON.stringify(
        normalizedRows.slice(0, 10),
      )}`,
    );
  }

  const headerRow = normalizedRows[headerRowIndex].map((cell) =>
    cell.toLowerCase(),
  );

  const dateIndex = headerRow.indexOf("date");
  const valueDateIndex = headerRow.indexOf("value date");
  const desc1Index = headerRow.indexOf("transaction description 1");
  const desc2Index = headerRow.indexOf("transaction description 2");
  const debitIndex = headerRow.indexOf("debit");
  const creditIndex = headerRow.indexOf("credit");
  const runningBalanceIndex = headerRow.indexOf("running balance");

  const transactions: ParsedTransaction[] = [];

  for (const row of normalizedRows.slice(headerRowIndex + 1)) {
    const transactionDate = parseDate(row[dateIndex]);

    if (!transactionDate) {
      continue;
    }

    const valueDate = parseDate(row[valueDateIndex]);

    const description1 = cleanCell(row[desc1Index]) || null;
    const description2 = cleanCell(row[desc2Index]) || null;

    const debit = parseAmount(row[debitIndex]);
    const credit = parseAmount(row[creditIndex]);
    const runningBalance = parseAmount(row[runningBalanceIndex]);

    const rawRow = {
      date: row[dateIndex],
      valueDate: row[valueDateIndex],
      description1,
      description2,
      debit,
      credit,
      runningBalance,
    };

    const rowHash = hashText(
      [
        account_number ?? "",
        statement_start_date,
        statement_end_date,
        transactionDate,
        valueDate ?? "",
        description1 ?? "",
        description2 ?? "",
        debit ?? "",
        credit ?? "",
        runningBalance ?? "",
      ].join("|"),
    );

    transactions.push({
      transaction_date: transactionDate,
      value_date: valueDate,
      description_1: description1,
      description_2: description2,
      debit,
      credit,
      running_balance: runningBalance,
      raw_row: rawRow,
      row_hash: rowHash,
    });
  }

  if (transactions.length === 0) {
    throw new Error("No transaction rows found.");
  }

  return {
    account_name,
    account_number,
    currency,
    statement_start_date,
    statement_end_date,
    opening_balance: parseAmount(openingBalanceRow?.[1]),
    ledger_balance: parseAmount(ledgerBalanceRow?.[1]),
    available_balance: parseAmount(availableBalanceRow?.[1]),
    printed_by: null,
    printed_on: null,
    transactions,
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file uploaded." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileHash = hashText(buffer.toString("base64"));

    const parsed = parseWorkbook(buffer);

    const result = await sql.begin(async (tx) => {
      await tx`
        delete from bank_transactions
        where upload_id in (
          select id
          from bank_statement_uploads
          where account_number = ${parsed.account_number}
            and statement_start_date = ${parsed.statement_start_date}
            and statement_end_date = ${parsed.statement_end_date}
        )
      `;

      await tx`
        delete from bank_statement_uploads
        where account_number = ${parsed.account_number}
          and statement_start_date = ${parsed.statement_start_date}
          and statement_end_date = ${parsed.statement_end_date}
      `;

      const insertedUploads = await tx<{ id: number }[]>`
        insert into bank_statement_uploads (
          file_name,
          file_hash,
          account_name,
          account_number,
          currency,
          statement_start_date,
          statement_end_date,
          opening_balance,
          ledger_balance,
          available_balance,
          printed_by,
          printed_on
        )
        values (
          ${file.name},
          ${fileHash},
          ${parsed.account_name},
          ${parsed.account_number},
          ${parsed.currency},
          ${parsed.statement_start_date},
          ${parsed.statement_end_date},
          ${parsed.opening_balance},
          ${parsed.ledger_balance},
          ${parsed.available_balance},
          ${parsed.printed_by},
          ${parsed.printed_on}
        )
        returning id
      `;

      const uploadId = insertedUploads[0]?.id;

      if (!uploadId) {
        throw new Error("Failed to create bank statement upload.");
      }

      for (const transaction of parsed.transactions) {
        await tx`
          insert into bank_transactions (
            upload_id,
            transaction_date,
            value_date,
            description_1,
            description_2,
            debit,
            credit,
            running_balance,
            raw_row,
            row_hash
          )
          values (
            ${uploadId},
            ${transaction.transaction_date},
            ${transaction.value_date},
            ${transaction.description_1},
            ${transaction.description_2},
            ${transaction.debit},
            ${transaction.credit},
            ${transaction.running_balance},
            ${sql.json(transaction.raw_row as any)},
            ${transaction.row_hash}
          )
        `;
      }

      return {
        uploadId,
        transactionCount: parsed.transactions.length,
        accountNumber: parsed.account_number,
        statementStartDate: parsed.statement_start_date,
        statementEndDate: parsed.statement_end_date,
      };
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Bank statement upload failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bank statement upload failed.",
      },
      { status: 400 },
    );
  }
}