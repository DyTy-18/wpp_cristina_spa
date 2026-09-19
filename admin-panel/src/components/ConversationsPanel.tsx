import { useCallback, useEffect, useState } from 'react';

import apiClient from '../api/client';
import { getSocket } from '../api/socket';
import ClientCell from './ClientCell';
import { formatDateTime } from '../utils/format';

interface Conversation {
  phone: string;
  nombre?: string;
  state: string;
  cita_id: number | string | null;
  created_at: string;
}

const STATE_LABELS: Record<string, string> = {
  esperando_confirmacion: 'Esperando confirmación',
  esperando_reagendar: 'Esperando reagendar',
};

export default function ConversationsPanel() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ conversations: Conversation[] }>(
        '/api/admin/citas/active-conversations'
      );
      setConversations(data.conversations);
      setError(null);
    } catch {
      setError('No se pudieron cargar las conversaciones.');
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    const socket = getSocket();
    socket.on('citas:update', fetchConversations);
    return () => {
      socket.off('citas:update', fetchConversations);
    };
  }, [fetchConversations]);

  return (
    <section className="panel">
      <div className="panel-head">
        <svg
          className="panel-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path
            d="M4 5.5h16v10H9l-4 3.5v-3.5H4v-10Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h2>Conversaciones activas</h2>
        <span className="badge">{conversations.length}</span>
      </div>
      {error && <p className="error-text">{error}</p>}

      {conversations.length === 0 ? (
        <p className="muted">No hay conversaciones en curso.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Estado</th>
                <th>Cita</th>
                <th>Desde</th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((conv) => (
                <tr key={conv.phone}>
                  <td>
                    <ClientCell nombre={conv.nombre} phone={conv.phone} />
                  </td>
                  <td>{STATE_LABELS[conv.state] ?? conv.state}</td>
                  <td>{conv.cita_id ?? '—'}</td>
                  <td className="nowrap-cell">
                    {formatDateTime(conv.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
