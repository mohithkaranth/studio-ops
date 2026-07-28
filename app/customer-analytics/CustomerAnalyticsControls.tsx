"use client";

import * as XLSX from "xlsx";

export type CustomerAnalyticsExportRow = {
  client: string;
  email: string;
  phone: string;
  firstBooking: string;
  lastBooking: string;
  totalBookings: number;
  averageBookingsPerMonth: number;
  monthsInactive: number;
};

type Props = {
  fromMonth: string;
  toMonth: string;
  averageBookings: number;
  inactiveMonths: number;
  minimumLifetimeBookings: number;
  maximumToMonth: string;
  validationMessage: string | null;
  results: CustomerAnalyticsExportRow[];
};

const inputClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100";

export default function CustomerAnalyticsControls({
  fromMonth,
  toMonth,
  averageBookings,
  inactiveMonths,
  minimumLifetimeBookings,
  maximumToMonth,
  validationMessage,
  results,
}: Props) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <form className="space-y-6">
        <input type="hidden" name="analysed" value="1" />
        <div>
          <h2 className="text-base font-medium text-zinc-100">Analysis Period</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Select the period used to identify regular customers.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm text-zinc-300">
              <span>From Month</span>
              <input className={inputClass} name="fromMonth" type="month" defaultValue={fromMonth} required />
            </label>
            <label className="space-y-1 text-sm text-zinc-300">
              <span>To Month</span>
              <input className={inputClass} name="toMonth" type="month" defaultValue={toMonth} max={maximumToMonth} required />
            </label>
          </div>
          {validationMessage ? (
            <p className="mt-3 text-sm text-red-400" role="alert">{validationMessage}</p>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <label className="space-y-1 text-sm text-zinc-300">
            <span className="block text-base font-medium text-zinc-100">Regular Customer Definition</span>
            <span className="block text-sm text-zinc-500">Minimum average bookings per month during the analysis period.</span>
            <span className="block pt-2">Average bookings per month</span>
            <input className={inputClass} name="averageBookings" type="number" min="1" step="0.01" defaultValue={averageBookings} required />
          </label>
          <label className="space-y-1 text-sm text-zinc-300">
            <span className="block text-base font-medium text-zinc-100">Inactive Period</span>
            <span className="block text-sm text-zinc-500">A customer is considered lost if they have had no bookings during this period.</span>
            <span className="block pt-2">No bookings in the last</span>
            <select className={inputClass} name="inactiveMonths" defaultValue={inactiveMonths}>
              {[3, 6, 9, 12].map((months) => <option key={months} value={months}>{months} months</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm text-zinc-300">
            <span className="block text-base font-medium text-zinc-100">Minimum Lifetime Bookings</span>
            <span className="block text-sm text-zinc-500">Exclude customers with only a small number of historical bookings.</span>
            <span className="block pt-2">Minimum bookings</span>
            <input className={inputClass} name="minimumLifetimeBookings" type="number" min="1" step="1" defaultValue={minimumLifetimeBookings} required />
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md bg-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white">Analyse</button>
          <button
            type="button"
            disabled={results.length === 0}
            onClick={() => {
              const rows = results.map((customer) => ({
                Client: customer.client,
                Email: customer.email,
                Phone: customer.phone,
                "First Booking": customer.firstBooking,
                "Last Booking": customer.lastBooking,
                "Total Bookings": customer.totalBookings,
                "Average Bookings / Month": customer.averageBookingsPerMonth,
                "Months Inactive": customer.monthsInactive,
                Status: "Lost",
              }));
              const worksheet = XLSX.utils.json_to_sheet(rows);
              const workbook = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(workbook, worksheet, "Lost customers");
              XLSX.writeFile(workbook, "customer-analytics.xlsx", { compression: true });
            }}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export to Excel
          </button>
        </div>
      </form>
    </section>
  );
}
