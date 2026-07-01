import type { DateRange } from "./semantic-query";

export type ParsedDateMention = { dateRange: DateRange | null; dateMentioned: boolean; parseable: boolean };

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_PATTERN = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

function ymd(year: number, month: number, day = 1) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function addMonths(year: number, month: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function parseDateMention(question: string, now = new Date()): ParsedDateMention {
  const text = question.toLowerCase().replace(/[“”]/g, " ").replace(/\s+/g, " ").trim();
  const monthYear = new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(20\\d{2})\\b`, "i").exec(text);
  if (monthYear) {
    const month = MONTHS[monthYear[1].replace(".", "").toLowerCase()];
    const year = Number(monthYear[2]);
    const next = addMonths(year, month, 1);
    return { dateMentioned: true, parseable: true, dateRange: { startDate: ymd(year, month), endDateExclusive: ymd(next.year, next.month), label: `${year}-${String(month).padStart(2, "0")}` } };
  }

  const bareMonth = new RegExp(`\\b(${MONTH_PATTERN})\\.?\\b`, "i").test(text);
  const yearMatch = /\b(?:for|in|during)?\s*(?:the\s+)?year\s+(20\d{2})\b|\b(?:in|for|during)\s+(20\d{2})\b|\b(20\d{2})\s+total\b/i.exec(text);
  if (yearMatch) {
    const year = Number(yearMatch[1] ?? yearMatch[2] ?? yearMatch[3]);
    return { dateMentioned: true, parseable: true, dateRange: { startDate: ymd(year, 1), endDateExclusive: ymd(year + 1, 1), label: String(year) } };
  }

  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (/\bthis year\b/i.test(text)) {
    return { dateMentioned: true, parseable: true, dateRange: { startDate: ymd(currentYear, 1), endDateExclusive: ymd(currentYear + 1, 1), label: String(currentYear) } };
  }
  if (/\bthis month\b/i.test(text)) {
    const next = addMonths(currentYear, currentMonth, 1);
    return { dateMentioned: true, parseable: true, dateRange: { startDate: ymd(currentYear, currentMonth), endDateExclusive: ymd(next.year, next.month), label: `${currentYear}-${String(currentMonth).padStart(2, "0")}` } };
  }
  if (/\blast month\b/i.test(text)) {
    const prev = addMonths(currentYear, currentMonth, -1);
    return { dateMentioned: true, parseable: true, dateRange: { startDate: ymd(prev.year, prev.month), endDateExclusive: ymd(currentYear, currentMonth), label: `${prev.year}-${String(prev.month).padStart(2, "0")}` } };
  }
  const lastMonths = /\b(?:past|last)\s+(\d{1,2})\s+months?\b/i.exec(text);
  if (lastMonths) {
    const months = Math.max(Number(lastMonths[1]), 1);
    const start = addMonths(currentYear, currentMonth, -(months - 1));
    const end = addMonths(currentYear, currentMonth, 1);
    return { dateMentioned: true, parseable: true, dateRange: { startDate: ymd(start.year, start.month), endDateExclusive: ymd(end.year, end.month), label: `past ${months} months` } };
  }
  if (bareMonth) return { dateMentioned: true, parseable: false, dateRange: null };
  return { dateMentioned: /\b20\d{2}\b/.test(text), parseable: false, dateRange: null };
}
