import crypto from "node:crypto";
import { sql } from "@/lib/db";
import { parseBankStatementXls } from "@/lib/bank-statements";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file upload" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".xls")) {
    return Response.json({ error: "Only .xls files are supported" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseBankStatementXls(file.name, buffer);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Parse failed" }, { status: 400 });
  }

  const uploadRows = await sql<{ id: number }[]>`
    select id from bank_statement_uploads
    where file_hash = ${parsed.fileHash}
       or (account_number = ${parsed.accountNumber} and statement_start_date = ${parsed.statementStartDate} and statement_end_date = ${parsed.statementEndDate})
  `;

  await sql.begin(async (tx) => {
    if (uploadRows.length > 0) {
      const ids = uploadRows.map((row) => row.id);
      await tx`delete from bank_transactions where upload_id = any(${tx.array(ids, "int4")})`;
      await tx`delete from bank_statement_uploads where id = any(${tx.array(ids, "int4")})`;
    }

    const inserted = await tx<{ id: number }[]>`
      insert into bank_statement_uploads (file_name, file_hash, account_name, account_number, currency, statement_start_date, statement_end_date, opening_balance, ledger_balance, available_balance, printed_by, printed_on)
      values (${parsed.fileName}, ${parsed.fileHash}, ${parsed.accountName}, ${parsed.accountNumber}, ${parsed.currency}, ${parsed.statementStartDate}, ${parsed.statementEndDate}, ${parsed.openingBalance}, ${parsed.ledgerBalance}, ${parsed.availableBalance}, ${parsed.printedBy}, ${parsed.printedOn})
      returning id
    `;

    const uploadId = inserted[0].id;

    if (parsed.transactions.length > 0) {
      for (const txn of parsed.transactions) {
        const rowHash = crypto
          .createHash("sha256")
          .update(`${uploadId}|${txn.transactionDate}|${txn.valueDate ?? ""}|${txn.description1 ?? ""}|${txn.description2 ?? ""}|${txn.debit ?? ""}|${txn.credit ?? ""}|${txn.runningBalance ?? ""}`)
          .digest("hex");

        await tx`
          insert into bank_transactions (upload_id, transaction_date, value_date, description_1, description_2, debit, credit, running_balance, transaction_type, payment_channel, counterparty_name, reference_text, raw_row, row_hash)
          values (${uploadId}, ${txn.transactionDate}, ${txn.valueDate}, ${txn.description1}, ${txn.description2}, ${txn.debit}, ${txn.credit}, ${txn.runningBalance}, null, null, null, null, ${txn.rawRow}, ${rowHash})
        `;
      }
    }
  });

  return Response.json({ ok: true });
}
