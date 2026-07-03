const POSSESSIVE_SUFFIX = /(?:'s|s)$/i;

export function normalizeAcuityClientSearchText(searchText: string | null | undefined): string | null {
  const normalized = searchText
    ?.toLowerCase()
    .replace(/[^a-z0-9@._+\-'\s]/g, " ")
    .split(/\s+/)
    .map((term) => term.replace(POSSESSIVE_SUFFIX, ""))
    .filter(Boolean)
    .join(" ")
    .trim();
  return normalized || null;
}

export function acuityClientSearchTerms(searchText: string | null | undefined): string[] {
  const normalized = normalizeAcuityClientSearchText(searchText);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}
