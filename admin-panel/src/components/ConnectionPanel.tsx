import { useCallback, useEffect, useState } from 'react';

import apiClient from '../api/client';

interface SessionStatus {
  status: string;
  qrcode: string | null;
}

const POLL_INTERVAL_MS = 5000;

export default function ConnectionPanel() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await apiClient.get<SessionStatus>(
        '/api/admin/session/status'
      );
      setSession(data);
      setError(null);
    } catch {
      setError('No se pudo obtener el estado de la sesión.');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleStart = async () => {
    setBusy(true);
    try {
      await apiClient.post('/api/admin/session/start', { waitQrCode: false });
      await fetchStatus();
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    setBusy(true);
    try {
      await apiClient.post('/api/admin/session/close');
      await fetchStatus();
    } finally {
      setBusy(false);
    }
  };

  const isClosed = !session || session.status === 'CLOSED';
  const isConnected = !isClosed && !session?.qrcode;

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
            d="M4 12a8 8 0 1 1 3.2 6.4L4 20l1.5-3.4A7.96 7.96 0 0 1 4 12Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h2>Conexión de WhatsApp</h2>
      </div>
      {error && <p className="error-text">{error}</p>}

      <span
        className={`connection-status ${
          !session ? '' : isClosed ? 'is-closed' : 'is-connected'
        }`}
      >
        <span className="dot" />
        {session?.status ?? 'Cargando…'}
      </span>

      {isClosed && (
        <button onClick={handleStart} disabled={busy}>
          Conectar
        </button>
      )}

      {!isClosed && session?.qrcode && (
        <div className="qr-box">
          <img src={session.qrcode} alt="Código QR de WhatsApp" />
          <p>Escanea este código con WhatsApp en tu teléfono.</p>
        </div>
      )}

      {isConnected && (
        <button onClick={handleClose} disabled={busy}>
          Desconectar
        </button>
      )}
    </section>
  );
}
