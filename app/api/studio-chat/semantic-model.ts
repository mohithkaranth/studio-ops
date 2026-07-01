import type { Domain } from "./semantic-query";

export type MetricDefinition = { label: string; expression: string; defaultFilter?: string };
export type DimensionDefinition = { label: string; expression?: string; column?: string; aliases?: string[] };
export type SemanticDomainModel = {
  table: string;
  defaultDateBasis: string;
  metrics: Record<string, MetricDefinition>;
  dimensions: Record<string, DimensionDefinition>;
  rowFields: string[];
  searchTextFields?: string[];
};

export const semanticModel: Record<Domain, SemanticDomainModel> = {
  bank: {
    table: "bank_transactions",
    defaultDateBasis: "transaction_date",
    metrics: {
      bank_credits: { label: "Bank credits", expression: "SUM(COALESCE(credit, 0))", defaultFilter: "credit > 0" },
      bank_debits: { label: "Bank debits", expression: "SUM(COALESCE(debit, 0))", defaultFilter: "debit > 0" },
      net_movement: { label: "Net movement", expression: "SUM(COALESCE(credit, 0)) - SUM(COALESCE(debit, 0))" },
      transaction_count: { label: "Transaction count", expression: "COUNT(*)" },
    },
    dimensions: {
      month: { expression: "date_trunc('month', transaction_date)::date", label: "Month" },
      year: { expression: "date_trunc('year', transaction_date)::date", label: "Year" },
      transaction_type: { column: "transaction_type", label: "Transaction type" },
      payment_channel: { column: "payment_channel", label: "Payment channel" },
      counterparty_name: { column: "counterparty_name", label: "Counterparty name" },
    },
    rowFields: ["transaction_date", "value_date", "description_1", "description_2", "debit", "credit", "amount", "transaction_type", "payment_channel", "counterparty_name", "reference_text", "running_balance"],
    searchTextFields: ["description_1", "description_2", "counterparty_name", "reference_text", "payment_channel"],
  },
  acuity: {
    table: "acuity_appointments",
    defaultDateBasis: "appointment_datetime",
    metrics: {
      booking_count: { label: "Booking count", expression: "COUNT(*)", defaultFilter: "COALESCE(canceled, false) IS FALSE" },
      booking_value: { label: "Booking value", expression: "SUM(COALESCE(price, 0))", defaultFilter: "COALESCE(canceled, false) IS FALSE" },
    },
    dimensions: {
      month: { expression: "date_trunc('month', appointment_datetime)::date", label: "Month" },
      year: { expression: "date_trunc('year', appointment_datetime)::date", label: "Year" },
      calendar_name: { column: "calendar_name", label: "Calendar name", aliases: ["room", "room type", "calendar"] },
      appointment_type_name: { column: "appointment_type_name", label: "Appointment type", aliases: ["service", "appointment type"] },
      paid_status: { column: "paid_status", label: "Paid status" },
    },
    rowFields: ["appointment_datetime", "created_datetime", "client_first_name", "client_last_name", "appointment_type_name", "calendar_name", "price", "paid_status", "canceled"],
  },
};
