import type { Domain } from "./semantic-query";

export type MetricDefinition = { label: string; expression: string; defaultFilter?: string };
export type DimensionDefinition = { label: string; expression?: string; column?: string; aliases?: string[] };
export type DateBasis = "transaction_date" | "value_date" | "appointment_datetime" | "created_datetime";

export type SemanticDomainModel = {
  table: string;
  defaultDateBasis: DateBasis;
  allowedDateBases: DateBasis[];
  metrics: Record<string, MetricDefinition>;
  dimensions: Record<string, DimensionDefinition>;
  rowFields: string[];
  searchTextFields?: string[];
};

export const semanticModel: Record<Domain, SemanticDomainModel> = {
  bank: {
    table: "bank_transactions",
    defaultDateBasis: "transaction_date",
    allowedDateBases: ["transaction_date", "value_date"],
    metrics: {
      bank_credits: { label: "Bank credits", expression: "SUM(COALESCE(credit, 0))", defaultFilter: "credit > 0" },
      average_bank_credit: { label: "Average bank credit", expression: "AVG(credit)", defaultFilter: "credit > 0" },
      highest_bank_credit: { label: "Highest bank credit", expression: "MAX(credit)", defaultFilter: "credit > 0" },
      lowest_bank_credit: { label: "Lowest bank credit", expression: "MIN(credit)", defaultFilter: "credit > 0" },
      bank_debits: { label: "Bank debits", expression: "SUM(COALESCE(debit, 0))", defaultFilter: "debit > 0" },
      average_bank_debit: { label: "Average bank debit", expression: "AVG(debit)", defaultFilter: "debit > 0" },
      highest_bank_debit: { label: "Highest bank debit", expression: "MAX(debit)", defaultFilter: "debit > 0" },
      lowest_bank_debit: { label: "Lowest bank debit", expression: "MIN(debit)", defaultFilter: "debit > 0" },
      net_movement: { label: "Net movement", expression: "SUM(COALESCE(credit, 0)) - SUM(COALESCE(debit, 0))" },
      average_net_movement: { label: "Average net movement", expression: "AVG(COALESCE(credit, 0) - COALESCE(debit, 0))" },
      highest_net_movement: { label: "Highest net movement", expression: "MAX(COALESCE(credit, 0) - COALESCE(debit, 0))" },
      lowest_net_movement: { label: "Lowest net movement", expression: "MIN(COALESCE(credit, 0) - COALESCE(debit, 0))" },
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
    allowedDateBases: ["appointment_datetime", "created_datetime"],
    metrics: {
      booking_count: { label: "Booking count", expression: "COUNT(*)", defaultFilter: "COALESCE(canceled, false) IS FALSE" },
      booking_value: { label: "Booking value", expression: "SUM(COALESCE(price, 0))", defaultFilter: "COALESCE(canceled, false) IS FALSE" },
      average_booking_price: { label: "Average booking price", expression: "AVG(price)", defaultFilter: "COALESCE(canceled, false) IS FALSE" },
      highest_booking_price: { label: "Highest booking price", expression: "MAX(price)", defaultFilter: "COALESCE(canceled, false) IS FALSE" },
      lowest_booking_price: { label: "Lowest booking price", expression: "MIN(price)", defaultFilter: "COALESCE(canceled, false) IS FALSE" },
      client_count: { label: "Client count", expression: "COUNT(DISTINCT COALESCE(NULLIF(trim(client_first_name || ' ' || client_last_name), ''), client_email))", defaultFilter: "COALESCE(canceled, false) IS FALSE" },
    },
    dimensions: {
      month: { expression: "date_trunc('month', appointment_datetime)::date", label: "Month" },
      year: { expression: "date_trunc('year', appointment_datetime)::date", label: "Year" },
      client_name: { expression: "COALESCE(NULLIF(trim(client_first_name || ' ' || client_last_name), ''), client_email, 'Unknown')", label: "Client name", aliases: ["client", "customer"] },
      calendar_name: { column: "calendar_name", label: "Calendar name", aliases: ["room", "room type", "calendar"] },
      appointment_type_name: { column: "appointment_type_name", label: "Appointment type", aliases: ["service", "appointment type"] },
      paid_status: { column: "paid_status", label: "Paid status" },
    },
    rowFields: ["appointment_datetime", "COALESCE(NULLIF(trim(client_first_name || ' ' || client_last_name), ''), client_email, 'Unknown') AS client_name", "client_email", "appointment_type_name", "calendar_name", "price", "paid_status", "canceled", "created_datetime"],
    searchTextFields: ["client_first_name", "client_last_name", "client_email", "appointment_type_name", "calendar_name"],
  },
};
