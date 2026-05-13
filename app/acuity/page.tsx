const ACUITY_APPOINTMENTS_URL = "https://acuityscheduling.com/api/v1/appointments";

type AcuityAppointment = {
  id: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  type?: string;
  calendar?: string;
  datetime?: string;
  datetimeCreated?: string;
  created?: string;
  paidDate?: string;
  paymentDate?: string;
  paidOn?: string;
  datetimePaid?: string;
  price?: string | number | null;
  paid?: string | boolean | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

function formatDateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function getCreatedTimestamp(appointment: AcuityAppointment) {
  return appointment.datetimeCreated ?? appointment.created;
}

function getPaymentTimestamp(appointment: AcuityAppointment) {
  return appointment.paidDate ?? appointment.paymentDate ?? appointment.paidOn ?? appointment.datetimePaid;
}

function formatDateInput(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDateInput(value?: string) {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && formatDateInput(parsed) === value;
}

function normalizeQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getValidDateOrFallback(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (isValidDateInput(value)) return value;
  return fallback;
}

function getDateRange(searchParams: SearchParams) {
  const now = new Date();
  const defaultFrom = formatDateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const defaultTo = formatDateInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));

  const rawFrom = normalizeQueryValue(searchParams.from);
  const rawTo = normalizeQueryValue(searchParams.to);

  const from = getValidDateOrFallback(rawFrom, defaultFrom);
  const to = getValidDateOrFallback(rawTo, defaultTo);

  if (from > to) {
    return { from: to, to: from };
  }

  return { from, to };
}

async function fetchAppointments(from: string, to: string): Promise<AcuityAppointment[]> {
  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;
  if (!userId || !apiKey) {
    throw new Error("Missing ACUITY_USER_ID or ACUITY_API_KEY environment variables.");
  }

  const authHeader = `Basic ${Buffer.from(`${userId}:${apiKey}`).toString("base64")}`;
  const url = new URL(ACUITY_APPOINTMENTS_URL);
  url.searchParams.set("max", "100");
  url.searchParams.set("direction", "ASC");
  url.searchParams.set("minDate", from);
  url.searchParams.set("maxDate", to);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: authHeader, Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Acuity request failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  return Array.isArray(payload) ? (payload as AcuityAppointment[]).slice(0, 100) : [];
}

export default async function AcuityPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const { from, to } = getDateRange(searchParams);

  let appointments: AcuityAppointment[] = [];
  let errorMessage = "";

  try {
    appointments = await fetchAppointments(from, to);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unable to fetch appointments.";
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-12 sm:px-10 lg:px-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">Acuity Bookings</h1>
          <p className="text-sm text-zinc-400 sm:text-base">Appointments for selected date range (earliest first, up to 100 records returned by Acuity).</p>
        </header>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 sm:p-5">
          <p className="text-sm text-zinc-300">
            Selected range: <span className="font-medium text-zinc-100">{from}</span> to <span className="font-medium text-zinc-100">{to}</span> (sorted oldest to newest, max 100 results)
          </p>
          <form method="GET" className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-zinc-300">
              <span>From</span>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-zinc-500 transition focus:ring"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-300">
              <span>To</span>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-zinc-500 transition focus:ring"
              />
            </label>
            <button
              type="submit"
              className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
            >
              Apply
            </button>
          </form>
        </section>

        {errorMessage ? (
          <div className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">{errorMessage}</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/80">
            <table className="min-w-full divide-y divide-zinc-800 text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  <th className="px-4 py-3 font-medium">ID</th><th className="px-4 py-3 font-medium">First Name</th><th className="px-4 py-3 font-medium">Last Name</th><th className="px-4 py-3 font-medium">Email</th><th className="px-4 py-3 font-medium">Appointment Type</th><th className="px-4 py-3 font-medium">Calendar</th><th className="px-4 py-3 font-medium">Appointment Date</th><th className="px-4 py-3 font-medium">Created Date</th><th className="px-4 py-3 font-medium">Payment Date</th><th className="px-4 py-3 font-medium">Price</th><th className="px-4 py-3 font-medium">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {appointments.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-6 text-center text-zinc-400">No appointments found for the selected date range.</td></tr>
                ) : (
                  appointments.map((appointment) => (
                    <tr key={appointment.id} className="hover:bg-zinc-900">
                      <td className="px-4 py-3">{appointment.id}</td><td className="px-4 py-3">{appointment.firstName ?? "—"}</td><td className="px-4 py-3">{appointment.lastName ?? "—"}</td><td className="px-4 py-3">{appointment.email ?? "—"}</td><td className="px-4 py-3">{appointment.type ?? "—"}</td><td className="px-4 py-3">{appointment.calendar ?? "—"}</td><td className="px-4 py-3">{formatDateTime(appointment.datetime)}</td><td className="px-4 py-3">{formatDateTime(getCreatedTimestamp(appointment))}</td><td className="px-4 py-3">{formatDateTime(getPaymentTimestamp(appointment))}</td><td className="px-4 py-3">{appointment.price ?? "—"}</td><td className="px-4 py-3">{appointment.paid == null ? "—" : String(appointment.paid)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
