import { useCallback, useEffect, useState } from 'react';

import apiClient from '../api/client';
import { getSocket } from '../api/socket';
import ClientCell from './ClientCell';
import { formatDateTime } from '../utils/format';

type CitaOutcome = 'confirmada' | 'cancelada' | 'reagendar';

interface CitaOutcomeEntry {
  phone: string;
  nombre?: string;
  cita_id: number | string | null;
  accion: CitaOutcome;
  timestamp: string;
}

const OUTCOME_PILL: Record<CitaOutcome, string> = {
  confirmada: 'status-pill--sent',
  cancelada: 'status-pill--failed',
  reagendar: 'status-pill--pending',
};

const OUTCOME_LABEL: Record<CitaOutcome, string> = {
  confirmada: 'Confirmó',
  cancelada: 'Canceló',
  reagendar: 'Pidió reagendar',
};

export default function OutcomesPanel() {
  const [outcomes, setOutcomes] = useState<CitaOutcomeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchOutcomes = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ outcomes: CitaOutcomeEntry[] }>(
        '/api/admin/citas/outcomes'
      );
      setOutcomes(data.outcomes);
      setError(null);
    } catch {
      setError('No se pudo cargar el historial de respuestas.');
    }
  }, []);

  useEffect(() => {
    fetchOutcomes();
    const socket = getSocket();
    socket.on('citas:update', fetchOutcomes);
    return () => {
      socket.off('citas:update', fetchOutcomes);
    };
  }, [fetchOutcomes]);

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
            d="M9 12.5 11 14.5 15.5 9M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h2>Respuestas de clientes</h2>
        <span className="badge">{outcomes.length}</span>
      </div>
      <p className="panel-subtitle">
        Qué decidió cada cliente al final de la conversación.
      </p>
      {error && <p className="error-text">{error}</p>}

      {outcomes.length === 0 ? (
        <p className="muted">Todavía nadie respondió a un recordatorio.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Cliente</th>
                <th>Cita</th>
                <th>Decisión</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o, i) => (
                <tr key={i}>
                  <td className="nowrap-cell">{formatDateTime(o.timestamp)}</td>
                  <td>
                    <ClientCell nombre={o.nombre} phone={o.phone} />
                  </td>
                  <td>{o.cita_id ?? '—'}</td>
                  <td>
                    <span className={`status-pill ${OUTCOME_PILL[o.accion]}`}>
                      {OUTCOME_LABEL[o.accion]}
                    </span>
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
