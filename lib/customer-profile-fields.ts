function object(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function answer(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every(item=>['string','number','boolean'].includes(typeof item))) return value.map(String).join(', ') || null;
  return null;
}
// Only expose recognised customer notes and form answers, never the full raw
// payload (which can also contain processor and administrative metadata).
export function customerProfileFields(raw: unknown) {
  const data = object(raw);
  const fullNotes = typeof data?.notes === 'string' ? data.notes.trim() : '';
  const notes = fullNotes ? fullNotes.slice(0,4000) : null;
  const answers: {form:string;question:string;answer:string}[] = [];
  let truncated = fullNotes.length > 4000;
  if (Array.isArray(data?.forms)) for (const rawForm of data.forms) {
    const form = object(rawForm);
    if (!form || !Array.isArray(form.values)) continue;
    for (const rawField of form.values) {
      const field = object(rawField);
      const value = field ? answer(field.value) : null;
      if (!field || value === null) continue;
      if (answers.length >= 100) { truncated = true; continue; }
      if (value.length > 2000) truncated = true;
      answers.push({form:typeof form.name==='string' ? form.name : 'Booking form',question:typeof field.name==='string' ? field.name : 'Form answer',answer:value.slice(0,2000)});
    }
  }
  return {notes,formAnswers:answers,truncated};
}
