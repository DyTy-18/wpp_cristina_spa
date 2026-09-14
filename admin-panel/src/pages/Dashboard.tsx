import AutomationPanel from '../components/AutomationPanel';
import ConnectionPanel from '../components/ConnectionPanel';
import ConversationsPanel from '../components/ConversationsPanel';
import OutcomesPanel from '../components/OutcomesPanel';
import RemindersPanel from '../components/RemindersPanel';
import RequestsPanel from '../components/RequestsPanel';
import SentMessagesPanel from '../components/SentMessagesPanel';
import { useAuth } from '../auth/AuthContext';

// El formulario de creación manual (SendReminderPanel) se ocultó a pedido
// del usuario — el componente sigue existiendo por si se reactiva luego.

export default function Dashboard() {
  const { logout } = useAuth();

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Cristina Spa</h1>
        <button className="ghost" onClick={logout}>
          Cerrar sesión
        </button>
      </header>

      <main className="dashboard-main">
        <AutomationPanel />
        <ConnectionPanel />

        <div className="panel-pair panel-pair--pipeline">
          <RemindersPanel />
          <span className="pipeline-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
              <path
                d="M5 12h14m0 0-5-5m5 5-5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <SentMessagesPanel />
        </div>

        <div className="panel-pair">
          <ConversationsPanel />
          <OutcomesPanel />
        </div>

        <RequestsPanel />
      </main>
    </div>
  );
}
