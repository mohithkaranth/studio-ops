// These sources are not studio session payments, regardless of date or amount.
export function ignoredBankCredit(description1: string | null, description2: string | null = null): boolean {
  const text = [description1, description2].filter(Boolean).join(' ').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\biras\b/.test(text) || /\b(?:mohith\s+karanth|karanth\s+mohith)\b/.test(text);
}
