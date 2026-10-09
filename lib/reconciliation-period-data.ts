import "server-only";
import { sql } from "@/lib/db";
import type { ReconciliationPeriod } from "./reconciliation-period";

export async function getReconciliationPeriods(): Promise<ReconciliationPeriod[]> {
  return await sql<ReconciliationPeriod[]>`
    SELECT DISTINCT
      TO_CHAR(appointment_datetime AT TIME ZONE 'Asia/Singapore', 'YYYY')::integer AS "year",
      TO_CHAR(appointment_datetime AT TIME ZONE 'Asia/Singapore', 'MM')::integer AS "month"
    FROM acuity_appointments
    WHERE appointment_datetime >= '2026-01-01T00:00:00+08:00'::timestamptz
    ORDER BY "year" DESC, "month" ASC
  `;
}

export async function getBankStatementCoverage(): Promise<{ from: string | null; to: string | null }> {
  const rows = await sql<{ from: string | null; to: string | null }[]>`
    SELECT MIN(statement_start_date)::text AS "from", MAX(statement_end_date)::text AS "to"
    FROM bank_statement_uploads WHERE UPPER(currency) = 'SGD'
  `;
  return rows[0] ?? { from: null, to: null };
}
