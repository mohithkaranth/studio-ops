// Matches the stable credit identity used by bank allocations. Debit identity
// also includes the debit amount, as in Studio Chat's dedicated debit tool.
export const BANK_REPORT_SOURCE = `(SELECT DISTINCT ON (source_key) * FROM (
  SELECT t.*, CASE WHEN t.debit > 0 THEN
    md5(md5(jsonb_build_array(u.account_number, upper(u.currency), t.transaction_date::date::text,
      t.value_date::date::text, t.description_1, t.description_2,
      round(t.credit * 100)::bigint, round(t.running_balance * 100)::bigint)::text)
      || ':' || round(coalesce(t.debit,0)*100)::bigint::text)
    ELSE md5(jsonb_build_array(u.account_number, upper(u.currency), t.transaction_date::date::text,
      t.value_date::date::text, t.description_1, t.description_2,
      round(t.credit * 100)::bigint, round(t.running_balance * 100)::bigint)::text)
    END AS source_key
  FROM bank_transactions t JOIN bank_statement_uploads u ON u.id=t.upload_id
  WHERE upper(u.currency)='SGD' AND
    ((t.credit>0 AND coalesce(t.debit,0)=0) OR (t.debit>0 AND coalesce(t.credit,0)=0))
) source_records ORDER BY source_key,id) bank_transactions`;
