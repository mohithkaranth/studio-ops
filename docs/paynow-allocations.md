# Saved PayNow reconciliation

The deployed app creates `bank_payment_allocations` and `bank_reconciliation_history` in its existing PostgreSQL database on first use, following the existing manual Acuity sync table setup pattern. No database credentials are sent to the browser.

Each allocation stores a stable bank source identity, original bank transaction ID, Acuity booking ID, allocated and full credit amounts in integer SGD cents, confirmation method, timestamp, source evidence and optional release timestamp. The stable identity includes account, currency, transaction/value dates, descriptions, credit and running balance. It survives replacement transaction IDs and overlapping statement uploads. Identical source identities represent the same credit; if a source lacks a running balance and contains otherwise indistinguishable duplicate transfers, those records require review before allocating them separately.

Automatic confirmations use only the existing unambiguous booking-reference rule. Credits referencing other known bookings are not automatically allocated, including bookings in other report months. Name-only candidates remain unconfirmed. Every reconciliation now saves confirmed allocations and reads existing allocations from all months. Existing manual edits and released allocations are not overwritten by an automatic rerun.

On Reconciliation, select September 2026 and choose **Check / resume PayNow history** to check January through September sequentially. Each month is saved independently, making interruption/retry resumable. Failed payment lookups produce an incomplete month rather than a false success. The source fingerprint invalidates history completeness after statement or booking data changes. Backfill never infers used payments from previous totals comparisons or automatically confirms name-only suggestions. Therefore it may leave a large unallocated pool requiring manual review.

On Upload Bank Statements, choose a statement and expand **Review / confirm payment** beside a PayNow credit. Enter the Acuity booking ID and allocated SGD amount. Setting the same booking's amount again replaces it; it does not add another allocation. Undo releases an allocation without deleting its confirmation record. Writes are guarded against cross-origin browser requests and validate the live SGD PayNow credit and booking. The application retains its existing access model.

All allocation changes acquire a PostgreSQL advisory transaction lock for the stable bank source identity. The total saved amounts across bookings cannot exceed the credit. Partial allocations leave only the remaining balance eligible for unsettled totals; four separate split payments remain four separate credits. Original statement contents are not modified. Allocations whose source record is no longer present in uploaded data are not applied to current booking results; re-uploading the identical source reattaches them.

The No settlement total sums the unallocated balances within the union of the displayed booking-to-session windows. It reports the actual date span and warns when history checks are incomplete. It never assigns this aggregate to bookings.

Tests: `node --experimental-strip-types --test tests/*.test.mjs`.
