export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-BO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-BO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Fecha/hora de la cita en sí (strings "YYYY-MM-DD" / "HH:MM", no ISO). */
export function formatCitaFechaHora(fecha: string, hora: string): string {
  const [year, month, day] = fecha.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  const fechaCorta = date.toLocaleDateString('es-BO', {
    day: '2-digit',
    month: 'short',
  });
  return `${fechaCorta} · ${hora}`;
}
