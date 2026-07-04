"use client";

const calendarOptions = ["Living Room", "Bedroom"];

type RoomUtilisationFiltersProps = {
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  calendars: string[];
};

export default function RoomUtilisationFilters({
  dateFrom,
  dateTo,
  timeFrom,
  timeTo,
  calendars,
}: RoomUtilisationFiltersProps) {
  return (
    <form
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
      onSubmit={(event) => {
        const form = event.currentTarget;
        const selectedCalendars = Array.from(
          form.querySelectorAll<HTMLInputElement>(
            'input[name="calendarOption"]:checked',
          ),
        ).map((input) => input.value);
        form.calendars.value = selectedCalendars.join(",");
        form
          .querySelectorAll<HTMLInputElement>('input[name="calendarOption"]')
          .forEach((input) => {
            input.disabled = true;
          });
      }}
    >
      <input
        type="hidden"
        name="calendars"
        defaultValue={calendars.join(",")}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-1 text-sm text-zinc-300">
          <span>Date from</span>
          <input
            name="dateFrom"
            type="date"
            defaultValue={dateFrom}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-sm text-zinc-300">
          <span>Date to</span>
          <input
            name="dateTo"
            type="date"
            defaultValue={dateTo}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-sm text-zinc-300">
          <span>Time from</span>
          <input
            name="timeFrom"
            type="time"
            defaultValue={timeFrom}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-sm text-zinc-300">
          <span>Time to</span>
          <input
            name="timeTo"
            type="time"
            defaultValue={timeTo}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
          />
        </label>
        <div className="space-y-2 text-sm text-zinc-300">
          <span>Calendars</span>
          {calendarOptions.map((calendar) => (
            <label
              key={calendar}
              className="flex items-center gap-2 text-zinc-300"
            >
              <input
                name="calendarOption"
                type="checkbox"
                value={calendar}
                defaultChecked={calendars.includes(calendar)}
                className="h-4 w-4 accent-zinc-200"
              />
              {calendar}
            </label>
          ))}
        </div>
      </div>
      <button
        type="submit"
        className="mt-5 rounded-md bg-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white"
      >
        Run report
      </button>
    </form>
  );
}
