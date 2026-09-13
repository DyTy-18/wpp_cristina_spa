import { useCallback, useEffect, useState } from 'react';

import apiClient from '../api/client';
import { getSocket } from '../api/socket';
import ClientCell from './ClientCell';
import { formatDateTime } from '../utils/format';
import { messageTypeLabel } from '../utils/labels';

interface SentMessageEntry {
  phone: string;
  nombre?: string;
  cita_id: number | string | null;
  template: string;
  trigger: 'inmediato' | 'recordatorio';
  status: 'success' | 'failed';
  timestamp: string;
}

export default function SentMessagesPanel() {
  const [messages, setMessages] = useState<SentMessageEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ messages: SentMessageEntry[] }>(
        '/api/admin/citas/sent-messages'
      );
      setMessages(data.messages);
      setError(null);
    } catch {
      setError('No se pudo cargar el historial de mensajes enviados.');
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    const socket = getSocket();
    socket.on('citas:update', fetchMessages);
    return () => {
      socket.off('citas:update', fetchMessages);
    };
  }, [fetchMessages]);

  return (
    <section className="panel panel--sent">
      <div className="panel-head">
        <svg
          className="panel-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M4 12.5 9.5 18 20 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2>Ya enviados</h2>
        <span className="badge">{messages.length}</span>
      </div>
      <p className="panel-subtitle">Historial de lo que ya salió por WhatsApp.</p>
      {error && <p className="error-text">{error}</p>}

      {messages.length === 0 ? (
        <p className="muted">Todavía no se ha enviado ningún mensaje.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Tipo</th>
              <th>Cliente</th>
              <th>Cita</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m, i) => (
              <tr key={i}>
                <td className="nowrap-cell">{formatDateTime(m.timestamp)}</td>
                <td>{messageTypeLabel(m.trigger, m.template)}</td>
                <td>
                  <ClientCell nombre={m.nombre} phone={m.phone} />
                </td>
                <td>{m.cita_id ?? '—'}</td>
                <td>
                  <span
                    className={`status-pill ${
                      m.status === 'failed' ? 'status-pill--failed' : 'status-pill--sent'
                    }`}
                  >
                    {m.status === 'failed' ? 'Falló' : 'Enviado'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
