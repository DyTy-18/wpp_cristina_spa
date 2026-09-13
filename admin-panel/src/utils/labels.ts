const REMINDER_LABELS: Record<string, string> = {
  recordatorio_24h: 'Recordatorio 1',
  recordatorio_1h: 'Recordatorio 2',
};

export function reminderLabel(template?: string): string {
  if (!template) return 'Recordatorio';
  return REMINDER_LABELS[template] ?? 'Recordatorio';
}

export function messageTypeLabel(
  trigger: 'inmediato' | 'recordatorio',
  template?: string
): string {
  if (trigger === 'inmediato') return 'Inmediato';
  return reminderLabel(template);
}
