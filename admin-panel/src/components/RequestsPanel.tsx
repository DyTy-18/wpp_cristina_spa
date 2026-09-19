import { useCallback, useEffect, useState } from 'react';

import apiClient from '../api/client';
import { getSocket } from '../api/socket';
import { formatTime } from '../utils/format';

interface RequestLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  timestamp: string;
}

export default function RequestsPanel() {
  const [requests, setRequests] = useState<RequestLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ requests: RequestLogEntry[] }>(
        '/api/admin/requests'
      );
      setRequests(data.requests);
      setError(null);
    } catch {
      setError('No se pudo cargar la actividad reciente.');
    }
  }, []);

  useEffect(() => {
    fetchRequests();
    const socket = getSocket();
    socket.on('citas:update', fetchRequests);
    return () => {
      socket.off('citas:update', fetchRequests);
    };
  }, [fetchRequests]);

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
            d="M3 12h4l2.5-7L13 19l2.5-7H21"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h2>Actividad del servidor</h2>
        <span className="badge">{requests.length}</span>
      </div>
      <p className="panel-subtitle">Llamadas reales a la API — Laravel, WhatsApp, etc.</p>
      {error && <p className="error-text">{error}</p>}

      {requests.length === 0 ? (
        <p className="muted">Todavía no hay actividad registrada.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Método</th>
                <th>Ruta</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r, i) => (
                <tr key={i}>
                  <td className="nowrap-cell">{formatTime(r.timestamp)}</td>
                  <td>{r.method}</td>
                  <td className="truncate">{r.path}</td>
                  <td className={r.status >= 400 ? 'error-text' : undefined}>
                    {r.status}
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
