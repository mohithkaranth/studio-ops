import {sql} from '@/lib/db';
import {CUSTOMER_IDENTITY_SQL} from '@/lib/customer-identity';
export type AnalyticsRow = {
  customer_key: string | null;
  client: string | null;
  email: string | null;
  phone: string | null;
  first_booking: string | null;
  last_booking: string | null;
  total_bookings: number | null;
  average_bookings_per_month: string | number | null;
  months_inactive: number | null;
  customers_analysed: number;
  regular_customers: number;
  lost_customers: number;
};

export async function getCustomerAnalytics({fromMonth,toMonth,averageBookings,inactiveMonths,minimumLifetimeBookings}: {fromMonth:string;toMonth:string;averageBookings:number;inactiveMonths:number;minimumLifetimeBookings:number}) {
  return await sql<AnalyticsRow[]>`
      WITH settings AS (
        SELECT
          ${`${fromMonth}-01`}::date AS period_start,
          (${`${toMonth}-01`}::date + INTERVAL '1 month') AS period_end,
          (${inactiveMonths} * INTERVAL '1 month') AS inactive_interval,
          ${averageBookings}::numeric AS minimum_average,
          ${minimumLifetimeBookings}::integer AS minimum_lifetime
      ), appointments AS (
        SELECT
          ${sql.unsafe(CUSTOMER_IDENTITY_SQL)} AS customer_key,
          COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', client_first_name, client_last_name)), ''),
            NULLIF(TRIM(client_email), ''),
            NULLIF(TRIM(client_phone), ''),
            'Unknown'
          ) AS client,
          client_email,
          client_phone,
          appointment_datetime
        FROM acuity_appointments
        WHERE appointment_datetime IS NOT NULL
          AND COALESCE(canceled, false) IS FALSE
      ), customer_activity AS (
        SELECT
          a.customer_key,
          (ARRAY_AGG(a.client ORDER BY a.appointment_datetime DESC))[1] AS client,
          (ARRAY_AGG(NULLIF(TRIM(a.client_email), '') ORDER BY a.appointment_datetime DESC)
            FILTER (WHERE NULLIF(TRIM(a.client_email), '') IS NOT NULL))[1] AS email,
          (ARRAY_AGG(NULLIF(TRIM(a.client_phone), '') ORDER BY a.appointment_datetime DESC)
            FILTER (WHERE NULLIF(TRIM(a.client_phone), '') IS NOT NULL))[1] AS phone,
          MIN((a.appointment_datetime AT TIME ZONE 'Asia/Singapore')::date) AS first_booking,
          MAX((a.appointment_datetime AT TIME ZONE 'Asia/Singapore')::date) AS last_booking,
          COUNT(*)::integer AS total_bookings,
          COUNT(*) FILTER (
            WHERE a.appointment_datetime >= (s.period_start::timestamp AT TIME ZONE 'Asia/Singapore')
              AND a.appointment_datetime < (s.period_end::timestamp AT TIME ZONE 'Asia/Singapore')
          )::integer AS period_bookings,
          COUNT(*) FILTER (
            WHERE a.appointment_datetime >= (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore') - s.inactive_interval) AT TIME ZONE 'Asia/Singapore')
              AND a.appointment_datetime < ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore')
          )::integer AS inactive_period_bookings,
          (EXTRACT(YEAR FROM AGE((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::date, MAX((a.appointment_datetime AT TIME ZONE 'Asia/Singapore')::date))) * 12
            + EXTRACT(MONTH FROM AGE((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::date, MAX((a.appointment_datetime AT TIME ZONE 'Asia/Singapore')::date))))::integer AS months_inactive,
          ((EXTRACT(YEAR FROM AGE(s.period_end, s.period_start)) * 12) + EXTRACT(MONTH FROM AGE(s.period_end, s.period_start)))::integer AS period_months,
          s.minimum_average,
          s.minimum_lifetime
        FROM appointments a
        CROSS JOIN settings s
        GROUP BY a.customer_key, s.period_start, s.period_end, s.inactive_interval, s.minimum_average, s.minimum_lifetime
      ), classified AS (
        SELECT *, period_bookings::numeric / period_months AS average_bookings_per_month,
          (period_bookings::numeric / period_months >= minimum_average AND total_bookings >= minimum_lifetime) AS is_regular
        FROM customer_activity
      ), summary AS (
        SELECT COUNT(*)::integer AS customers_analysed,
          COUNT(*) FILTER (WHERE is_regular)::integer AS regular_customers,
          COUNT(*) FILTER (WHERE is_regular AND inactive_period_bookings = 0)::integer AS lost_customers
        FROM classified
      )
      SELECT c.customer_key, c.client, c.email, c.phone,
        TO_CHAR(c.first_booking, 'YYYY-MM-DD') AS first_booking,
        TO_CHAR(c.last_booking, 'YYYY-MM-DD') AS last_booking,
        c.total_bookings, c.average_bookings_per_month, COALESCE(c.months_inactive, 0)::integer AS months_inactive,
        s.customers_analysed, s.regular_customers, s.lost_customers
      FROM summary s
      LEFT JOIN classified c ON c.is_regular AND c.inactive_period_bookings = 0
      ORDER BY c.months_inactive DESC NULLS LAST, c.client ASC, c.customer_key ASC;
    `;
}
