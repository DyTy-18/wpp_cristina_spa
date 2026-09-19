import AutomationPanel from '../components/AutomationPanel';
import CitasPipelinePanel from '../components/CitasPipelinePanel';
import ConnectionPanel from '../components/ConnectionPanel';
import ConversationsPanel from '../components/ConversationsPanel';
import OutcomesPanel from '../components/OutcomesPanel';
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

        <CitasPipelinePanel />

        <ConversationsPanel />
        <OutcomesPanel />

        <SentMessagesPanel />

        <RequestsPanel />
      </main>
    </div>
  );
}
