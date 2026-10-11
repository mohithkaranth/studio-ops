export type Allocation = {
  transactionKey: string;
  appointmentId: string;
  cents: number;
};

// Amounts are integer SGD cents. Setting an allocation is idempotent; other bookings'
// allocations always reduce the available balance, regardless of their report month.
export function allocationBalance(creditCents: number, allocations: Allocation[], appointmentId?: string) {
  if (!Number.isSafeInteger(creditCents) || creditCents <= 0) throw new Error("Invalid bank credit.");
  const used = allocations.filter(item => item.appointmentId !== appointmentId)
    .reduce((sum, item) => {
      if (!Number.isSafeInteger(item.cents) || item.cents <= 0) throw new Error("Invalid saved allocation.");
      return sum + item.cents;
    }, 0);
  if (!Number.isSafeInteger(used) || used > creditCents) throw new Error("Saved allocations exceed this credit.");
  return creditCents - used;
}

export function assertAllocation(creditCents: number, allocations: Allocation[], appointmentId: string, cents: number) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Enter a positive amount with up to two decimal places.");
  if (cents > allocationBalance(creditCents, allocations, appointmentId)) throw new Error("This amount would reuse money already allocated to another booking.");
}
