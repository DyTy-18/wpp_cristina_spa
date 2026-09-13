import { useCallback, useEffect, useState } from 'react';

import apiClient from '../api/client';
import { getSocket } from '../api/socket';
import ClientCell from './ClientCell';
import { formatDateTime } from '../utils/format';
import { reminderLabel } from '../utils/labels';

interface ScheduledReminder {
  id: string;
  send_at: string;
  phone: string;
  message: string;
  template?: string;
  cita_id: number | string | null;
  cita?: { cliente: { nombre: string; apellido: string } };
}

export default function RemindersPanel() {
  const [reminders, setReminders] = useState<ScheduledReminder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [justSentIds, setJustSentIds] = useState<Set<string>>(new Set());

  const fetchReminders = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ reminders: ScheduledReminder[] }>(
        '/api/admin/citas/scheduled-reminders'
      );
      setReminders(data.reminders);
      setError(null);
    } catch {
      setError('No se pudieron cargar los recordatorios.');
    }
  }, []);

  useEffect(() => {
    fetchReminders();
    const socket = getSocket();
    socket.on('citas:update', fetchReminders);
    return () => {
      socket.off('citas:update', fetchReminders);
    };
  }, [fetchReminders]);

  const handleCancel = async (id: string) => {
    await apiClient.delete(`/api/admin/citas/scheduled-reminders/${id}`);
    await fetchReminders();
  };

  const handleSendNow = async (id: string) => {
    setSendingId(id);
    setError(null);
    try {
      await apiClient.post(`/api/admin/citas/scheduled-reminders/${id}/send-now`);
      setJustSentIds((prev) => new Set(prev).add(id));
      await fetchReminders();
    } catch {
      setError('No se pudo enviar el recordatorio.');
    } finally {
      setSendingId(null);
    }
  };

  const clienteNombre = (reminder: ScheduledReminder) =>
    reminder.cita
      ? `${reminder.cita.cliente.nombre} ${reminder.cita.cliente.apellido}`.trim()
      : undefined;

  return (
    <section className="panel panel--pending">
      <div className="panel-head">
        <svg
          className="panel-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2>Por enviar</h2>
        <span className="badge">{reminders.length}</span>
      </div>
      <p className="panel-subtitle">Recordatorios en cola, todavía no salieron.</p>
      {error && <p className="error-text">{error}</p>}

      {reminders.length === 0 ? (
        <p className="muted">No hay recordatorios pendientes.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Envío</th>
              <th>Tipo</th>
              <th>Cliente</th>
              <th>Cita</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reminders.map((reminder) => (
              <tr key={reminder.id}>
                <td className="nowrap-cell">{formatDateTime(reminder.send_at)}</td>
                <td>{reminderLabel(reminder.template)}</td>
                <td>
                  <ClientCell nombre={clienteNombre(reminder)} phone={reminder.phone} />
                </td>
                <td>{reminder.cita_id ?? '—'}</td>
                <td className="row-actions">
                  <button
                    onClick={() => handleSendNow(reminder.id)}
                    disabled={sendingId === reminder.id}
                  >
                    {sendingId === reminder.id ? 'Enviando…' : 'Enviar ahora'}
                  </button>
                  <button
                    className="ghost"
                    onClick={() => handleCancel(reminder.id)}
                    disabled={sendingId === reminder.id}
                  >
                    Cancelar
                  </button>
                  {justSentIds.has(reminder.id) && (
                    <span className="status-pill status-pill--sent">
                      Copia enviada
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
