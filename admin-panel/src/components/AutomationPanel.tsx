import { useCallback, useEffect, useState } from 'react';

import apiClient from '../api/client';
import { getSocket } from '../api/socket';

interface AutomationStatus {
  paused: boolean;
  updatedAt: string;
}

export default function AutomationPanel() {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await apiClient.get<AutomationStatus>('/api/admin/automation');
      setStatus(data);
      setError(null);
    } catch {
      setError('No se pudo cargar el estado de los envíos.');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const socket = getSocket();
    socket.on('citas:update', fetchStatus);
    return () => {
      socket.off('citas:update', fetchStatus);
    };
  }, [fetchStatus]);

  const handleToggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const action = status?.paused ? 'resume' : 'pause';
      await apiClient.post(`/api/admin/automation/${action}`);
      await fetchStatus();
    } catch {
      setError('No se pudo cambiar el estado.');
    } finally {
      setBusy(false);
    }
  };

  const paused = status?.paused ?? false;

  return (
    <section className={`panel ${paused ? 'panel--paused' : ''}`}>
      <div className="panel-head">
        <svg
          className="panel-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          {paused ? (
            <path d="M8 5v14M16 5v14" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M7 5v14l12-7L7 5Z" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        <h2>Envío de mensajes</h2>
      </div>
      {error && <p className="error-text">{error}</p>}

      <span
        className={`connection-status ${paused ? 'is-closed' : 'is-connected'}`}
      >
        <span className="dot" />
        {paused ? 'Pausado' : 'Activo'}
      </span>

      <p className="panel-subtitle">
        {paused
          ? 'No se está mandando ningún mensaje a WhatsApp. Las citas y respuestas de clientes se siguen procesando normal, solo el envío está detenido.'
          : 'Todo funcionando normal — recordatorios y respuestas se mandan como corresponde.'}
      </p>

      <button onClick={handleToggle} disabled={busy || !status}>
        {busy
          ? 'Actualizando…'
          : paused
            ? 'Reanudar envíos'
            : 'Pausar envíos'}
      </button>
    </section>
  );
}
