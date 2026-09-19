import { useCallback, useEffect, useMemo, useState } from 'react';

import apiClient from '../api/client';
import { getSocket } from '../api/socket';
import ClientCell from './ClientCell';
import { formatCitaFechaHora, formatDateTime } from '../utils/format';
import { messageTypeLabel } from '../utils/labels';

interface SentMessageEntry {
  phone: string;
  nombre?: string;
  cita_id: number | string | null;
  template: string;
  trigger: 'inmediato' | 'recordatorio';
  status: 'success' | 'failed' | 'paused';
  timestamp: string;
  cita?: {
    fecha: string;
    hora: string;
    servicios?: string[];
    empleado?: string;
  };
}

interface ClientGroup {
  phone: string;
  nombre?: string;
  entries: SentMessageEntry[];
  lastTimestamp: string;
}

const STATUS_PILL: Record<SentMessageEntry['status'], string> = {
  success: 'status-pill--sent',
  failed: 'status-pill--failed',
  paused: 'status-pill--pending',
};

const STATUS_LABEL: Record<SentMessageEntry['status'], string> = {
  success: 'Enviado',
  failed: 'Falló',
  paused: 'Pausado',
};

export default function SentMessagesPanel() {
  const [messages, setMessages] = useState<SentMessageEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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

  // Un mismo cliente puede tener varias visitas — se agrupa por teléfono en
  // vez de listar todo suelto, así cada cliente es un desplegable con su
  // propio historial adentro.
  const groups = useMemo(() => {
    const map = new Map<string, ClientGroup>();
    for (const m of messages) {
      let group = map.get(m.phone);
      if (!group) {
        group = {
          phone: m.phone,
          nombre: m.nombre,
          entries: [],
          lastTimestamp: m.timestamp,
        };
        map.set(m.phone, group);
      }
      if (!group.nombre && m.nombre) group.nombre = m.nombre;
      if (m.timestamp > group.lastTimestamp) group.lastTimestamp = m.timestamp;
      group.entries.push(m);
    }
    return Array.from(map.values()).sort((a, b) =>
      b.lastTimestamp.localeCompare(a.lastTimestamp)
    );
  }, [messages]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.nombre?.toLowerCase().includes(q) || g.phone.toLowerCase().includes(q)
    );
  }, [groups, search]);

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
        <span className="badge">
          {search
            ? `${filteredGroups.length} / ${groups.length}`
            : `${groups.length} cliente${groups.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <p className="panel-subtitle">
        Historial de lo que ya salió por WhatsApp, agrupado por cliente —
        desplegá uno para ver todas sus visitas.
      </p>
      {error && <p className="error-text">{error}</p>}

      {messages.length > 0 && (
        <input
          className="panel-search"
          type="text"
          placeholder="Buscar por nombre o teléfono…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {messages.length === 0 ? (
        <p className="muted">Todavía no se ha enviado ningún mensaje.</p>
      ) : filteredGroups.length === 0 ? (
        <p className="muted">Ningún cliente coincide con "{search}".</p>
      ) : (
        filteredGroups.map((group) => (
          <details key={group.phone} className="client-group">
            <summary className="client-group-summary">
              <div className="client-group-client">
                <ClientCell nombre={group.nombre} phone={group.phone} />
              </div>
              <div className="client-group-meta">
                <span className="cell-sub">
                  {formatDateTime(group.lastTimestamp)}
                </span>
                <span className="badge">{group.entries.length}</span>
              </div>
            </summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Tipo</th>
                    <th>Cita</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map((m, i) => (
                    <tr key={i}>
                      <td className="nowrap-cell">
                        {formatDateTime(m.timestamp)}
                      </td>
                      <td>{messageTypeLabel(m.trigger, m.template)}</td>
                      <td>
                        {m.cita ? (
                          <div>
                            <div>
                              {formatCitaFechaHora(m.cita.fecha, m.cita.hora)}
                            </div>
                            {m.cita.servicios &&
                              m.cita.servicios.length > 0 && (
                                <div className="cell-sub">
                                  {m.cita.servicios.join(', ')}
                                </div>
                              )}
                          </div>
                        ) : (
                          <span className="muted">{m.cita_id ?? '—'}</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-pill ${STATUS_PILL[m.status]}`}
                        >
                          {STATUS_LABEL[m.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))
      )}
    </section>
  );
}
