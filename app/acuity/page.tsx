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

async function fetchAppointments(): Promise<AcuityAppointment[]> {
  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;
  if (!userId || !apiKey) {
    throw new Error("Missing ACUITY_USER_ID or ACUITY_API_KEY environment variables.");
  }

  const authHeader = `Basic ${Buffer.from(`${userId}:${apiKey}`).toString("base64")}`;
  const url = new URL(ACUITY_APPOINTMENTS_URL);
  url.searchParams.set("max", "20");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: authHeader, Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Acuity request failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  return Array.isArray(payload) ? (payload as AcuityAppointment[]).slice(0, 20) : [];
}

export default async function AcuityPage() {
  let appointments: AcuityAppointment[] = [];
  let errorMessage = "";

  try {
    appointments = await fetchAppointments();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unable to fetch appointments.";
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-12 sm:px-10 lg:px-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">Acuity Bookings</h1>
          <p className="text-sm text-zinc-400 sm:text-base">Recent appointments (up to 20 records).</p>
        </header>

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
                  <tr><td colSpan={11} className="px-4 py-6 text-center text-zinc-400">No appointments found.</td></tr>
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
