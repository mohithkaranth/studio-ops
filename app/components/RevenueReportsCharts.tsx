"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type RevenueReportPoint = {
  month_label: string;
  revenue: number;
  expenses: number;
};

type TooltipPayload = Array<{
  name?: string;
  value?: number;
}>;

const sgdFormatter = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
  maximumFractionDigits: 0,
});

function EmptyChartState() {
  return (
    <div className="flex h-72 min-w-0 items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60 px-4 text-center text-sm text-zinc-500">
      No bank transaction data available yet.
    </div>
  );
}

function CurrencyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-100 shadow-xl">
      {label ? <p className="mb-1 font-medium text-zinc-200">{label}</p> : null}
      <div className="space-y-1">
        {payload.map((item) => (
          <p key={item.name} className="text-zinc-300">
            <span className="text-zinc-500">{item.name}: </span>
            <span className="text-zinc-100">{sgdFormatter.format(item.value ?? 0)}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function currencyTick(value: number) {
  return sgdFormatter.format(value);
}

function MonthlyBarChart({
  data,
  dataKey,
  fill,
  name,
}: {
  data: RevenueReportPoint[];
  dataKey: "revenue" | "expenses";
  fill: string;
  name: string;
}) {
  if (data.length === 0) return <EmptyChartState />;

  return (
    <div className="h-72 min-w-0 w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 12, right: 16, left: 16, bottom: 24 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 4" vertical />
          <XAxis
            dataKey="month_label"
            interval={0}
            angle={-35}
            textAnchor="end"
            height={62}
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={{ stroke: "#3f3f46" }}
          />
          <YAxis
            tickFormatter={currencyTick}
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={{ stroke: "#3f3f46" }}
            width={72}
          />
          <Tooltip content={<CurrencyTooltip />} cursor={{ fill: "rgba(63, 63, 70, 0.22)" }} />
          <Bar dataKey={dataKey} fill={fill} radius={[5, 5, 0, 0]} name={name} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RevenueVsExpenseChart({ data }: { data: RevenueReportPoint[] }) {
  if (data.length === 0) return <EmptyChartState />;

  return (
    <div className="h-80 min-w-0 w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 12, right: 16, left: 16, bottom: 24 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 4" vertical />
          <XAxis
            dataKey="month_label"
            interval={0}
            angle={-35}
            textAnchor="end"
            height={62}
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={{ stroke: "#3f3f46" }}
          />
          <YAxis
            tickFormatter={currencyTick}
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={{ stroke: "#3f3f46" }}
            width={72}
          />
          <Tooltip content={<CurrencyTooltip />} cursor={{ fill: "rgba(63, 63, 70, 0.22)" }} />
          <Legend wrapperStyle={{ color: "#d4d4d8", fontSize: "12px" }} />
          <Bar dataKey="revenue" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Revenue" />
          <Bar dataKey="expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Expenses" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="text-lg font-medium text-zinc-50">{title}</h2>
      <p className="mb-3 text-xs text-zinc-400">{description}</p>
      {children}
    </section>
  );
}

export default function RevenueReportsCharts({ data }: { data: RevenueReportPoint[] }) {
  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Revenue by month" description="Monthly sum of credited bank transactions.">
        <MonthlyBarChart data={data} dataKey="revenue" fill="#06b6d4" name="Revenue" />
      </ChartCard>

      <ChartCard title="Expense by month" description="Monthly sum of debited bank transactions.">
        <MonthlyBarChart data={data} dataKey="expenses" fill="#f59e0b" name="Expenses" />
      </ChartCard>

      <div className="xl:col-span-2">
        <ChartCard
          title="Revenue vs Expense by month"
          description="Monthly credited and debited bank transaction totals side by side."
        >
          <RevenueVsExpenseChart data={data} />
        </ChartCard>
      </div>
    </section>
  );
}