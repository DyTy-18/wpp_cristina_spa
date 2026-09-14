/*
 * Manejo de estados de conversación para confirmación de citas — Cristina Spa
 *
 * Guarda en memoria el estado de cada número mientras dura la conversación.
 * Estados posibles:
 *   esperando_confirmacion  — se envió solicitud de confirmación, esperando 1 o 2
 *   esperando_reagendar     — cliente dijo 2 (cancelar), se le preguntó si quiere reagendar
 */

import api from 'axios';
import { Logger } from 'winston';

import { guardedSendText } from './automationState';
import { recordCitaOutcome } from './citaOutcomesLog';
import { emitCitasUpdate } from './realtime';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ConversationState = 'esperando_confirmacion' | 'esperando_reagendar';

interface Conversation {
  state: ConversationState;
  cita_id: number | string | null;
  phone: string;
  nombre?: string;
  created_at: string;
}

// ─── Storage en memoria ───────────────────────────────────────────────────────

// Clave: número de teléfono normalizado
const conversations = new Map<string, Conversation>();

// Mapeo LID → phone (para cuando WhatsApp usa identificadores internos)
const lidToPhone = new Map<string, string>();

export function setConversation(
  phone: string,
  state: ConversationState,
  cita_id: number | string | null,
  nombre?: string
): void {
  conversations.set(phone, {
    state,
    cita_id,
    phone,
    nombre,
    created_at: new Date().toISOString(),
  });
  emitCitasUpdate();
}

export function registerLid(lid: string, phone: string): void {
  lidToPhone.set(lid, phone);
}

export function getConversation(phone: string): Conversation | undefined {
  return conversations.get(phone);
}

export function clearConversation(phone: string): void {
  conversations.delete(phone);
  // Limpiar también entradas LID asociadas
  for (const [lid, p] of lidToPhone.entries()) {
    if (p === phone) lidToPhone.delete(lid);
  }
  emitCitasUpdate();
}

export function listConversations(): Conversation[] {
  return Array.from(conversations.values());
}

// ─── Procesador de respuestas ─────────────────────────────────────────────────

export async function handleIncomingMessage(
  client: any,
  message: any,
  callbackUrl: string,
  logger: Logger
): Promise<void> {
  // Log de diagnóstico — remover cuando todo funcione
  logger.info(
    `[CitasConv] mensaje recibido | fromMe=${message.fromMe} isGroupMsg=${message.isGroupMsg} type=${message.type} from=${message.from} body=${message.body}`
  );

  // Solo mensajes de texto entrantes (no propios, no grupos)
  if (message.fromMe || message.isGroupMsg) return;
  if (message.type !== 'chat') return;

  // Resolver el número real
  const fromRaw = message.from as string;
  let rawPhone = fromRaw
    .replace(/@c\.us|@s\.whatsapp\.net/g, '')
    .replace(/\D/g, '');

  if (fromRaw.includes('@lid')) {
    const lid = fromRaw.replace('@lid', '');
    const phoneFromMap = lidToPhone.get(lid);
    if (phoneFromMap) {
      rawPhone = phoneFromMap;
      logger.info(`[CitasConv] LID resuelto por mapa: ${lid} → ${rawPhone}`);
    } else {
      logger.warn(
        `[CitasConv] LID ${lid} no está en el mapa — conversaciones activas: ${JSON.stringify(
          Array.from(conversations.keys())
        )}`
      );
      return;
    }
  }

  logger.info(
    `[CitasConv] phone="${rawPhone}" — conv activa: ${JSON.stringify(
      getConversation(rawPhone)
    )}`
  );
  const conv = getConversation(rawPhone);

  if (!conv) return; // No hay conversación activa para este número

  const respuesta = (message.body as string).trim();

  // ── esperando_confirmacion: cliente responde 1 (confirmar) o 2 (cancelar) ──
  if (conv.state === 'esperando_confirmacion') {
    if (respuesta === '1') {
      clearConversation(rawPhone);
      logger.info(
        `[CitasConv] ${rawPhone} confirmó cita #${conv.cita_id ?? 'N/A'}`
      );
      recordCitaOutcome({
        phone: rawPhone,
        nombre: conv.nombre,
        cita_id: conv.cita_id,
        accion: 'confirmada',
        timestamp: new Date().toISOString(),
      });

      await notificarLaravel(
        callbackUrl,
        {
          cita_id: conv.cita_id,
          phone: rawPhone,
          accion: 'confirmada',
        },
        logger
      );

      await guardedSendText(
        client,
        message.from,
        `✅ ¡Perfecto! Tu cita ha sido *confirmada*. ¡Te esperamos! 💆‍♀️✨`,
        logger
      );
    } else if (respuesta === '2') {
      conv.state = 'esperando_reagendar';
      conversations.set(rawPhone, conv);
      emitCitasUpdate();
      logger.info(
        `[CitasConv] ${rawPhone} quiere cancelar cita #${
          conv.cita_id ?? 'N/A'
        } — preguntando reagendar`
      );

      await guardedSendText(
        client,
        message.from,
        `😔 Entendemos. ¿Deseas *reagendar* tu cita para otro horario?\n\n` +
          `Responde *1* para 🗓️ Reagendar\n` +
          `Responde *2* para ❌ Cancelar definitivamente`,
        logger
      );
    } else {
      // Respuesta no reconocida
      await guardedSendText(
        client,
        message.from,
        `Por favor responde *1* para Confirmar o *2* para Cancelar.`,
        logger
      );
    }
    return;
  }

  // ── esperando_reagendar: cliente responde 1 (reagendar) o 2 (cancelar) ──────
  if (conv.state === 'esperando_reagendar') {
    if (respuesta === '1') {
      clearConversation(rawPhone);
      logger.info(
        `[CitasConv] ${rawPhone} quiere reagendar cita #${
          conv.cita_id ?? 'N/A'
        }`
      );
      recordCitaOutcome({
        phone: rawPhone,
        nombre: conv.nombre,
        cita_id: conv.cita_id,
        accion: 'reagendar',
        timestamp: new Date().toISOString(),
      });

      await notificarLaravel(
        callbackUrl,
        {
          cita_id: conv.cita_id,
          phone: rawPhone,
          accion: 'reagendar',
        },
        logger
      );

      await guardedSendText(
        client,
        message.from,
        `🗓️ ¡Perfecto! Una de nuestras colaboradoras se pondrá en contacto contigo a la brevedad para coordinar un nuevo horario. 💕`,
        logger
      );
    } else if (respuesta === '2') {
      clearConversation(rawPhone);
      logger.info(
        `[CitasConv] ${rawPhone} canceló definitivamente cita #${
          conv.cita_id ?? 'N/A'
        }`
      );
      recordCitaOutcome({
        phone: rawPhone,
        nombre: conv.nombre,
        cita_id: conv.cita_id,
        accion: 'cancelada',
        timestamp: new Date().toISOString(),
      });

      await notificarLaravel(
        callbackUrl,
        {
          cita_id: conv.cita_id,
          phone: rawPhone,
          accion: 'cancelada',
        },
        logger
      );

      await guardedSendText(
        client,
        message.from,
        `😔 Tu cita ha sido *cancelada*. Si en algún momento deseas agendar nuevamente, estamos aquí para ayudarte. 💕`,
        logger
      );
    } else {
      await guardedSendText(
        client,
        message.from,
        `Por favor responde *1* para Reagendar o *2* para Cancelar definitivamente.`,
        logger
      );
    }
    return;
  }
}

// ─── Notificación a Laravel ───────────────────────────────────────────────────

async function notificarLaravel(
  callbackUrl: string,
  data: { cita_id: number | string | null; phone: string; accion: string },
  logger: Logger
): Promise<void> {
  if (!callbackUrl) {
    logger.warn(
      `[CitasConv] No hay citasCallbackUrl configurado — no se notificó a Laravel.`
    );
    return;
  }

  try {
    await api.post(callbackUrl, data);
    logger.info(
      `[CitasConv] Laravel notificado — accion="${data.accion}" cita_id=${data.cita_id}`
    );
  } catch (error) {
    logger.error(`[CitasConv] Error al notificar Laravel: ${error}`);
  }
}
