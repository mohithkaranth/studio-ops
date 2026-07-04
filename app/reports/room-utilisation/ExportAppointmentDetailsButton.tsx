"use client";

import * as XLSX from "xlsx";

type AppointmentDetailsExportRow = {
  appointment_time_sgt: string;
  created_time_sgt: string | null;
  client_name: string;
  appointment_type_name: string | null;
  calendar_name: string;
  price: string | number | null;
};

type ExportAppointmentDetailsButtonProps = {
  appointments: AppointmentDetailsExportRow[];
};

const exportHeaders = [
  "Appointment Time SGT",
  "Created Time SGT",
  "Client",
  "Appointment Type",
  "Calendar",
  "Price",
];

function normalisePrice(value: string | number | null) {
  if (value === null) return "";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

export default function ExportAppointmentDetailsButton({
  appointments,
}: ExportAppointmentDetailsButtonProps) {
  return (
    <button
      type="button"
      disabled={appointments.length === 0}
      onClick={() => {
        const rows = appointments.map((appointment) => ({
          "Appointment Time SGT": appointment.appointment_time_sgt,
          "Created Time SGT": appointment.created_time_sgt ?? "",
          Client: appointment.client_name,
          "Appointment Type": appointment.appointment_type_name ?? "",
          Calendar: appointment.calendar_name,
          Price: normalisePrice(appointment.price),
        }));
        const worksheet = XLSX.utils.json_to_sheet(rows, {
          header: exportHeaders,
        });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Appointment details");
        XLSX.writeFile(workbook, "room-utilisation-details.xlsx", {
          compression: true,
        });
      }}
      className="rounded-md bg-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      Export to Excel
    </button>
  );
}
