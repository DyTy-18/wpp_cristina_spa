import { useCallback, useEffect, useState } from 'react';

import apiClient from '../api/client';

type Status = 'CLOSED' | 'INITIALIZING' | 'QRCODE' | 'SYNCING' | 'CONNECTED';

interface SessionStatus {
  status: Status | string;
  qrcode: string | null;
  phone?: string | null;
  closedReason?: string | null;
}

const POLL_INTERVAL_MS = 5000;

const STATUS_LABEL: Record<string, string> = {
  CLOSED: 'Desconectado',
  INITIALIZING: 'Iniciando…',
  QRCODE: 'Esperando escaneo',
  SYNCING: 'Sincronizando…',
  CONNECTED: 'Conectado',
};

// Por qué quedó cerrada la sesión (lo informa el servidor).
const CLOSED_REASON: Record<string, string> = {
  QR_EXPIRED: 'El código QR venció sin escanearse.',
  UNLINKED:
    'El número se desvinculó desde el teléfono. Conecta para vincular un número.',
  LOGOUT: 'Número desvinculado. Conecta para vincular otro número.',
  SYNC_TIMEOUT: 'La sincronización no terminó a tiempo.',
  BROWSER_CLOSED: 'El navegador de WhatsApp se cerró inesperadamente.',
  START_FAILED: 'No se pudo iniciar la sesión.',
};

export default function ConnectionPanel() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
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

  const run = async (path: string, body?: object) => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(path, body);
    } catch {
      setError('La acción falló. Intenta de nuevo.');
    } finally {
      setConfirmLogout(false);
      await fetchStatus();
      setBusy(false);
    }
  };

  const status = session?.status ?? null;
  const isClosed = !session || status === 'CLOSED';
  const isConnected = status === 'CONNECTED';
  const isLinking =
    status === 'INITIALIZING' || status === 'QRCODE' || status === 'SYNCING';
  const reason =
    isClosed && session?.closedReason
      ? CLOSED_REASON[session.closedReason]
      : null;

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
          !session
            ? ''
            : isConnected
            ? 'is-connected'
            : isClosed
            ? 'is-closed'
            : ''
        }`}
      >
        <span className="dot" />
        {status ? STATUS_LABEL[status] ?? status : 'Cargando…'}
        {isConnected && session?.phone && ` · +${session.phone}`}
      </span>

      {reason && <p className="muted">{reason}</p>}

      {status === 'QRCODE' && session?.qrcode && (
        <div className="qr-box">
          <img src={session.qrcode} alt="Código QR de WhatsApp" />
          <p>
            En el teléfono: WhatsApp → Dispositivos vinculados → Vincular un
            dispositivo.
          </p>
        </div>
      )}

      {status === 'SYNCING' && (
        <p className="muted">
          QR escaneado. WhatsApp está sincronizando, puede tardar unos minutos.
          No vuelvas a escanear.
        </p>
      )}

      {isClosed && (
        <button
          onClick={() => run('/api/admin/session/start', { waitQrCode: false })}
          disabled={busy}
        >
          Conectar
        </button>
      )}

      {(isConnected || isLinking) && !confirmLogout && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="ghost"
            onClick={() => run('/api/admin/session/close')}
            disabled={busy}
          >
            {isConnected ? 'Desconectar' : 'Cancelar'}
          </button>
          {isConnected && (
            <button
              className="ghost"
              onClick={() => setConfirmLogout(true)}
              disabled={busy}
            >
              Cambiar número
            </button>
          )}
        </div>
      )}

      {confirmLogout && (
        <div>
          <p>
            Se desvinculará{' '}
            <strong>+{session?.phone ?? 'el número actual'}</strong> y se
            borrará su sesión. Después podrás vincular otro número con un QR
            nuevo.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => run('/api/admin/session/logout')}
              disabled={busy}
            >
              Sí, desvincular
            </button>
            <button
              className="ghost"
              onClick={() => setConfirmLogout(false)}
              disabled={busy}
            >
              No
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
