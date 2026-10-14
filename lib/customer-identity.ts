// The first email is primary; additional recipients remain contact-search aliases.
// Customer identity is independent of display names and phone formatting.
export const CUSTOMER_IDENTITY_SQL = `COALESCE(
  'email:' || NULLIF(LOWER(TRIM(SPLIT_PART(REPLACE(client_email, ';', ','), ',', 1))), ''),
  'phone:' || NULLIF(CASE WHEN LENGTH(REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g'))=8 THEN '65' || REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g') ELSE REGEXP_REPLACE(client_phone, '[^0-9]', '', 'g') END, ''),
  'appointment:' || acuity_appointment_id::text
)`;

export function customerIdentity(email: string | null, phone: string | null, bookingId: string) {
  const normalizedEmail = email?.split(/[,;]/)[0]?.trim().toLowerCase();
  const digits = phone?.replace(/\D/g, '');
  const normalizedPhone = digits?.length===8 ? '65'+digits : digits;
  return normalizedEmail ? `email:${normalizedEmail}` : normalizedPhone ? `phone:${normalizedPhone}` : `appointment:${bookingId}`;
}
