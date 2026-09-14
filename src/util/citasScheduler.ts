/*
 * Scheduler de recordatorios de citas — Cristina Spa
 *
 * Guarda los recordatorios pendientes en un archivo JSON local.
 * Cada 60 segundos revisa si alguno debe enviarse y lo despacha.
 */

import fs from 'fs';
import path from 'path';
import { Logger } from 'winston';

import { isPaused } from './automationState';
import { registerLid, setConversation } from './citasConversation';
import { emitCitasUpdate } from './realtime';
import { recordSentMessage } from './sentMessagesLog';
import { clientsArray } from './sessionUtil';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ScheduledReminderCita {
  fecha: string;
  hora: string;
  cliente: { nombre: string; apellido: string };
  servicios?: string[];
  empleado?: string;
  notas?: string;
}

export interface ScheduledReminder {
  id: string; // UUID generado al crear
  session: string; // nombre de la sesión WPP (ej: "citas")
  send_at: string; // ISO 8601 — "2026-03-16T17:00:00"
  phone: string; // número normalizado
  message: string; // mensaje ya construido
  template?: string; // nombre de la plantilla usada (para el historial de enviados)
  cita_id?: number | string | null;
  created_at: string;
  // Datos de la cita original — permiten reconstruir el mensaje con el
  // tiempo restante real si se envía manualmente antes de su hora programada.
  cita?: ScheduledReminderCita;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

// Vive en su propia carpeta (no en la raíz del proyecto) para poder montarla
// como volumen en Docker sin el problema de montar un archivo suelto que
// todavía no existe (Docker lo crearía como carpeta, no como archivo).
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORAGE_FILE = path.join(DATA_DIR, 'scheduled-reminders.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readReminders(): ScheduledReminder[] {
  try {
    if (!fs.existsSync(STORAGE_FILE)) return [];
    const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
    return JSON.parse(raw) as ScheduledReminder[];
  } catch {
    return [];
  }
}

function writeReminders(reminders: ScheduledReminder[]): void {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(reminders, null, 2), 'utf-8');
}

// ─── API pública ─────────────────────────────────────────────────────────────

export function addReminder(
  reminder: Omit<ScheduledReminder, 'id' | 'created_at'>
): ScheduledReminder {
  const reminders = readReminders();
  const newReminder: ScheduledReminder = {
    ...reminder,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
  };
  reminders.push(newReminder);
  writeReminders(reminders);
  emitCitasUpdate();
  return newReminder;
}

export function listReminders(): ScheduledReminder[] {
  return readReminders();
}

/**
 * Elimina los recordatorios pendientes de una cita (opcionalmente filtrando
 * por plantilla). Se usa antes de reprogramar, para que reprocesar la misma
 * cita no acumule recordatorios duplicados en la cola.
 */
export function removeRemindersForCita(
  citaId: number | string | null | undefined,
  template?: string
): void {
  if (citaId == null) return;
  const reminders = readReminders();
  const filtered = reminders.filter(
    (r) => !(r.cita_id === citaId && (!template || r.template === template))
  );
  if (filtered.length !== reminders.length) {
    writeReminders(filtered);
    emitCitasUpdate();
  }
}

export function deleteReminder(id: string): boolean {
  const reminders = readReminders();
  const filtered = reminders.filter((r) => r.id !== id);
  if (filtered.length === reminders.length) return false;
  writeReminders(filtered);
  emitCitasUpdate();
  return true;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export function startCitasScheduler(logger: Logger): void {
  logger.info('[CitasScheduler] Iniciado — revisando cada 60 segundos.');

  setInterval(async () => {
    const now = new Date();
    const pending = readReminders();

    const due = pending.filter((r) => new Date(r.send_at) <= now);
    if (due.length === 0) return;

    if (isPaused()) {
      logger.warn(
        `[CitasScheduler] Envíos pausados — ${due.length} recordatorio(s) esperando a que se reactive.`
      );
      return;
    }

    logger.info(`[CitasScheduler] ${due.length} recordatorio(s) para enviar.`);

    const remaining = pending.filter((r) => new Date(r.send_at) > now);

    for (const reminder of due) {
      const client = (clientsArray as any)[reminder.session];

      if (!client) {
        logger.warn(
          `[CitasScheduler] Sesión "${reminder.session}" no encontrada. Reintentará en el próximo ciclo.`
        );
        remaining.push(reminder); // re-encola
        continue;
      }

      // Se revisa en cada mensaje, no solo al empezar la tanda — si alguien
      // pausa a mitad de un lote largo, el resto se re-encola en vez de seguir mandando.
      if (isPaused()) {
        logger.warn(
          `[CitasScheduler] Envíos pausados a mitad de la tanda — se re-encola el resto.`
        );
        remaining.push(reminder);
        continue;
      }

      const nombre = reminder.cita
        ? `${reminder.cita.cliente.nombre} ${reminder.cita.cliente.apellido}`.trim()
        : undefined;

      try {
        const result = await client.sendText(reminder.phone, reminder.message);
        setConversation(
          reminder.phone,
          'esperando_confirmacion',
          reminder.cita_id ?? null,
          nombre
        );

        // El resultado del sendText contiene el "to" real usado por WhatsApp
        // Si usó un LID, lo registramos para poder resolverlo cuando el cliente responda
        try {
          const toRaw: string =
            (result as any)?.to || (result as any)?.chatId?._serialized || '';
          if (toRaw.includes('@lid')) {
            const lid = toRaw.replace('@lid', '');
            registerLid(lid, reminder.phone);
            logger.info(
              `[CitasScheduler] LID registrado desde result: ${lid} → ${reminder.phone}`
            );
          }
        } catch (e) {
          logger.warn(
            `[CitasScheduler] No se pudo registrar LID desde result: ${e}`
          );
        }

        logger.info(
          `[CitasScheduler] Enviado a ${reminder.phone} — cita #${
            reminder.cita_id ?? 'N/A'
          }`
        );
        recordSentMessage({
          phone: reminder.phone,
          nombre,
          cita_id: reminder.cita_id ?? null,
          template: reminder.template ?? 'recordatorio',
          trigger: 'recordatorio',
          status: 'success',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(
          `[CitasScheduler] Error al enviar a ${reminder.phone}: ${error}`
        );
        recordSentMessage({
          phone: reminder.phone,
          nombre,
          cita_id: reminder.cita_id ?? null,
          template: reminder.template ?? 'recordatorio',
          trigger: 'recordatorio',
          status: 'failed',
          error: String(error),
          timestamp: new Date().toISOString(),
        });
        // No re-encola — evita spam si hay un error persistente
      }

      // Pausa entre mensajes (con variación) para no mandar ráfagas de
      // texto idéntico en el mismo segundo — eso es justo el patrón que
      // WhatsApp detecta como bot.
      const pauseMs = 2500 + Math.floor(Math.random() * 2500);
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }

    writeReminders(remaining);
  }, 60_000);
}
