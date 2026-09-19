import { useCallback, useEffect, useMemo, useState } from 'react';

import apiClient from '../api/client';
import { getSocket } from '../api/socket';
import ClientCell from './ClientCell';
import { formatCitaFechaHora, formatDateTime } from '../utils/format';

interface CitaInfo {
  fecha: string;
  hora: string;
  servicios?: string[];
  empleado?: string;
}

interface ScheduledReminder {
  id: string;
  send_at: string;
  phone: string;
  template?: string;
  cita_id: number | string | null;
  cita?: { cliente: { nombre: string; apellido: string } } & Partial<CitaInfo>;
}

interface SentMessageEntry {
  phone: string;
  nombre?: string;
  cita_id: number | string | null;
  template: string;
  trigger: 'inmediato' | 'recordatorio';
  status: 'success' | 'failed' | 'paused';
  timestamp: string;
  cita?: CitaInfo;
}

type SlotStatus =
  | { kind: 'pending'; reminderId: string; sendAt: string }
  | { kind: 'sent'; timestamp: string; status: 'success' | 'failed' | 'paused' };

interface CitaGroup {
  key: string;
  cita_id: number | string | null;
  nombre?: string;
  phone: string;
  cita?: CitaInfo;
  recordatorio_24h?: SlotStatus;
  recordatorio_1h?: SlotStatus;
}

const REMINDER_TEMPLATES = ['recordatorio_24h', 'recordatorio_1h'] as const;
type ReminderTemplate = (typeof REMINDER_TEMPLATES)[number];

function isReminderTemplate(t?: string): t is ReminderTemplate {
  return t === 'recordatorio_24h' || t === 'recordatorio_1h';
}

/**
 * Agrupa por cita_id en vez de listar recordatorios sueltos — cada cita
 * siempre tiene 2 (24h y 1h antes), y la pregunta real de quien mira el
 * panel es "¿ya salió el primero de estos dos?", no "¿qué recordatorios
 * hay en la tabla?".
 */
export default function CitasPipelinePanel() {
  const [reminders, setReminders] = useState<ScheduledReminder[]>([]);
  const [messages, setMessages] = useState<SentMessageEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [justSentIds, setJustSentIds] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    try {
      const [remindersRes, messagesRes] = await Promise.all([
        apiClient.get<{ reminders: ScheduledReminder[] }>(
          '/api/admin/citas/scheduled-reminders'
        ),
        apiClient.get<{ messages: SentMessageEntry[] }>(
          '/api/admin/citas/sent-messages'
        ),
      ]);
      setReminders(remindersRes.data.reminders);
      setMessages(messagesRes.data.messages);
      setError(null);
    } catch {
      setError('No se pudieron cargar los recordatorios.');
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const socket = getSocket();
    socket.on('citas:update', fetchAll);
    return () => {
      socket.off('citas:update', fetchAll);
    };
  }, [fetchAll]);

  const groups = useMemo(() => {
    const map = new Map<string, CitaGroup>();
    let noIdCounter = 0;

    const getGroup = (
      cita_id: number | string | null,
      phone: string
    ): CitaGroup => {
      const key = cita_id != null ? `id:${cita_id}` : `noid:${noIdCounter++}`;
      let group = map.get(key);
      if (!group) {
        group = { key, cita_id, phone };
        map.set(key, group);
      }
      return group;
    };

    // Pendientes primero — son la fuente más confiable de fecha/hora/servicios
    // (siempre traen el snapshot completo de la cita).
    for (const r of reminders) {
      if (!isReminderTemplate(r.template)) continue;
      const group = getGroup(r.cita_id, r.phone);
      if (r.cita) {
        group.nombre = `${r.cita.cliente.nombre} ${r.cita.cliente.apellido}`.trim();
        if (r.cita.fecha && r.cita.hora) {
          group.cita = {
            fecha: r.cita.fecha,
            hora: r.cita.hora,
            servicios: r.cita.servicios,
            empleado: r.cita.empleado,
          };
        }
      }
      group[r.template as ReminderTemplate] = {
        kind: 'pending',
        reminderId: r.id,
        sendAt: r.send_at,
      };
    }

    // Enviados — solo llenan el casillero si no hay uno pendiente ya puesto.
    // En el caso normal no compiten (un recordatorio despachado se borra de
    // la cola); si compiten, gana el pendiente por ser la acción que falta.
    for (const m of messages) {
      if (m.trigger !== 'recordatorio' || !isReminderTemplate(m.template)) {
        continue;
      }
      const group = getGroup(m.cita_id, m.phone);
      if (!group.nombre && m.nombre) group.nombre = m.nombre;
      if (!group.cita && m.cita) group.cita = m.cita;
      const slotKey = m.template as ReminderTemplate;
      if (!group[slotKey]) {
        group[slotKey] = {
          kind: 'sent',
          timestamp: m.timestamp,
          status: m.status,
        };
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const aTime = a.cita ? `${a.cita.fecha}T${a.cita.hora}` : '';
      const bTime = b.cita ? `${b.cita.fecha}T${b.cita.hora}` : '';
      return aTime.localeCompare(bTime);
    });
  }, [reminders, messages]);

  // Recordatorios pendientes que no son parte del par 24h/1h (ej. algo
  // agendado a mano con otra plantilla, o datos viejos sin template) — no
  // encajan en la tabla agrupada, pero tampoco deben desaparecer de la vista.
  const otherPending = useMemo(
    () => reminders.filter((r) => !isReminderTemplate(r.template)),
    [reminders]
  );

  const handleCancel = async (reminderId: string) => {
    await apiClient.delete(`/api/admin/citas/scheduled-reminders/${reminderId}`);
    await fetchAll();
  };

  const handleSendNow = async (reminderId: string) => {
    setActingId(reminderId);
    setError(null);
    try {
      await apiClient.post(
        `/api/admin/citas/scheduled-reminders/${reminderId}/send-now`
      );
      setJustSentIds((prev) => new Set(prev).add(reminderId));
      await fetchAll();
    } catch {
      setError('No se pudo enviar el recordatorio.');
    } finally {
      setActingId(null);
    }
  };

  const renderSlot = (slot: SlotStatus | undefined) => {
    if (!slot) return <span className="muted">—</span>;

    if (slot.kind === 'sent') {
      const pillClass =
        slot.status === 'success'
          ? 'status-pill--sent'
          : slot.status === 'failed'
            ? 'status-pill--failed'
            : 'status-pill--pending';
      const label =
        slot.status === 'success'
          ? 'Enviado'
          : slot.status === 'failed'
            ? 'Falló'
            : 'Pausado';
      return (
        <div className="reminder-slot">
          <span className={`status-pill ${pillClass}`}>{label}</span>
          <span className="cell-sub">{formatDateTime(slot.timestamp)}</span>
        </div>
      );
    }

    return (
      <div className="reminder-slot">
        <span className="status-pill status-pill--pending">Programado</span>
        <span className="cell-sub">{formatDateTime(slot.sendAt)}</span>
        <div className="row-actions">
          <button
            onClick={() => handleSendNow(slot.reminderId)}
            disabled={actingId === slot.reminderId}
          >
            {actingId === slot.reminderId ? 'Enviando…' : 'Enviar ahora'}
          </button>
          <button
            className="ghost"
            onClick={() => handleCancel(slot.reminderId)}
            disabled={actingId === slot.reminderId}
          >
            Cancelar
          </button>
        </div>
        {justSentIds.has(slot.reminderId) && (
          <span className="status-pill status-pill--sent">Copia enviada</span>
        )}
      </div>
    );
  };

  return (
    <section className="panel panel--pending">
      <div className="panel-head">
        <svg
          className="panel-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2>Recordatorios de citas</h2>
        <span className="badge">{groups.length}</span>
      </div>
      <p className="panel-subtitle">
        Cada cita tiene 2 recordatorios (24h y 1h antes) — acá se ve si ya
        salieron o siguen en cola.
      </p>
      {error && <p className="error-text">{error}</p>}

      {groups.length === 0 ? (
        <p className="muted">No hay recordatorios de citas por ahora.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Cita</th>
                <th>Recordatorio 1 (24h)</th>
                <th>Recordatorio 2 (1h)</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key}>
                  <td>
                    <ClientCell nombre={group.nombre} phone={group.phone} />
                  </td>
                  <td>
                    {group.cita ? (
                      <div>
                        <div>
                          {formatCitaFechaHora(
                            group.cita.fecha,
                            group.cita.hora
                          )}
                        </div>
                        {group.cita.servicios &&
                          group.cita.servicios.length > 0 && (
                            <div className="cell-sub">
                              {group.cita.servicios.join(', ')}
                            </div>
                          )}
                      </div>
                    ) : (
                      <span className="muted">{group.cita_id ?? '—'}</span>
                    )}
                  </td>
                  <td>{renderSlot(group.recordatorio_24h)}</td>
                  <td>{renderSlot(group.recordatorio_1h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {otherPending.length > 0 && (
        <>
          <p className="panel-subtitle">
            Otros envíos programados (no forman parte del par 24h/1h):
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Envío</th>
                  <th>Cliente</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {otherPending.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap-cell">
                      {formatDateTime(r.send_at)}
                    </td>
                    <td>
                      <ClientCell
                        nombre={
                          r.cita
                            ? `${r.cita.cliente.nombre} ${r.cita.cliente.apellido}`.trim()
                            : undefined
                        }
                        phone={r.phone}
                      />
                    </td>
                    <td className="row-actions">
                      <button
                        onClick={() => handleSendNow(r.id)}
                        disabled={actingId === r.id}
                      >
                        {actingId === r.id ? 'Enviando…' : 'Enviar ahora'}
                      </button>
                      <button
                        className="ghost"
                        onClick={() => handleCancel(r.id)}
                        disabled={actingId === r.id}
                      >
                        Cancelar
                      </button>
                      {justSentIds.has(r.id) && (
                        <span className="status-pill status-pill--sent">
                          Copia enviada
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
