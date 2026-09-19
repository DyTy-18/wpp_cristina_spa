/*
 * Copyright 2021 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Request, Response } from 'express';

import { guardedSendText, isPaused } from '../util/automationState';
import {
  clearConversationForCita,
  listConversations,
  registerLid,
  setConversation,
} from '../util/citasConversation';
import {
  addReminder,
  deleteReminder,
  listReminders,
  removeRemindersForCita,
} from '../util/citasScheduler';
import { CitaSnapshot, recordSentMessage } from '../util/sentMessagesLog';

// ─── Tipos ──────────────────────────────────────────────────────────────────

interface CitaCliente {
  nombre: string;
  apellido: string;
  telefono: string;
}

interface CitaPayload {
  id?: number | string;
  fecha: string; // "2026-03-20"
  hora: string; // "14:30"
  estado?: string; // pendiente | confirmada | completada | cancelada
  accion?: 'actualizada' | 'eliminada'; // solo viene en el push process-cita
  cliente: CitaCliente;
  servicios?: string[];
  empleado?: string;
  notas?: string;
  precio_final?: number | string;
}

type TemplateKey =
  | 'solicitud_confirmacion'
  | 'recordatorio_24h'
  | 'recordatorio_1h'
  | 'confirmacion'
  | 'cancelacion'
  | 'reagendacion'
  | 'default';

// Plantillas que le piden al cliente responder 1/2 — solo estas deben abrir
// una conversación de confirmación (las demás son avisos, no preguntas).
const CONFIRM_TEMPLATES: TemplateKey[] = [
  'solicitud_confirmacion',
  'recordatorio_24h',
  'recordatorio_1h',
];

// ─── Templates de mensajes ───────────────────────────────────────────────────

function formatFecha(fecha: string): string {
  const [year, month, day] = fecha.split('-');
  const meses = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  return `${parseInt(day)} de ${meses[parseInt(month) - 1]} de ${year}`;
}

function buildMessage(cita: CitaPayload, template: TemplateKey): string {
  const nombre = `${cita.cliente.nombre} ${cita.cliente.apellido}`.trim();
  const fecha = formatFecha(cita.fecha);
  const hora = cita.hora;
  const servicios =
    cita.servicios && cita.servicios.length > 0
      ? cita.servicios.join(', ')
      : 'servicios agendados';
  const empleado = cita.empleado ? `\n👩 Atendida por: *${cita.empleado}*` : '';
  const notas = cita.notas ? `\n📝 Notas: ${cita.notas}` : '';

  switch (template) {
    case 'solicitud_confirmacion':
      return (
        `¡Hola *${nombre}*! 🌸\n\n` +
        `Tienes una cita agendada en *Cristina Spa*:\n\n` +
        `📅 *Fecha:* ${fecha}\n` +
        `⏰ *Hora:* ${hora}\n` +
        `💅 *Servicios:* ${servicios}` +
        empleado +
        notas +
        `\n\n¿Vas a poder asistir?\n` +
        `Responde *1* para ✅ Confirmar\n` +
        `Responde *2* para ❌ Cancelar`
      );

    case 'recordatorio_24h':
      return (
        `¡Hola *${nombre}*! 👋\n\n` +
        `Te recordamos que mañana tienes una cita en *Cristina Spa*:\n\n` +
        `📅 *Fecha:* ${fecha}\n` +
        `⏰ *Hora:* ${hora}\n` +
        `💅 *Servicios:* ${servicios}` +
        empleado +
        notas +
        `\n\n¿Vas a poder asistir?\n` +
        `Responde *1* para ✅ Confirmar\n` +
        `Responde *2* para ❌ Cancelar`
      );

    case 'recordatorio_1h':
      return (
        `¡Hola *${nombre}*! ⏰\n\n` +
        `Tu cita en *Cristina Spa* es en aproximadamente 1 hora:\n\n` +
        `⏰ *Hora:* ${hora}\n` +
        `💅 *Servicios:* ${servicios}` +
        empleado +
        `\n\n¿Vas a poder asistir?\n` +
        `Responde *1* para ✅ Confirmar\n` +
        `Responde *2* para ❌ Cancelar`
      );

    case 'confirmacion':
      return (
        `¡Hola *${nombre}*! 🌸\n\n` +
        `Tu cita en *Cristina Spa* ha sido *confirmada*:\n\n` +
        `📅 *Fecha:* ${fecha}\n` +
        `⏰ *Hora:* ${hora}\n` +
        `💅 *Servicios:* ${servicios}` +
        empleado +
        notas +
        `\n\n¡Te esperamos con mucho gusto! Si necesitas hacer algún cambio, contáctanos. ✨`
      );

    case 'cancelacion':
      return (
        `¡Hola *${nombre}*! 😔\n\n` +
        `Lamentamos informarte que tu cita del *${fecha}* a las *${hora}* en *Cristina Spa* ha sido *cancelada*.\n\n` +
        `Si deseas reagendar, responde a este mensaje y con gusto te ayudamos a encontrar un nuevo horario. 💕`
      );

    case 'reagendacion':
      return (
        `¡Hola *${nombre}*! 🗓️\n\n` +
        `Entendemos que necesitas reagendar tu cita del *${fecha}* a las *${hora}*.\n\n` +
        `Una de nuestras colaboradoras se pondrá en contacto contigo a la brevedad para coordinar un nuevo horario. 💕\n\n` +
        `¡Gracias por avisarnos! ✨`
      );

    case 'default':
    default:
      return (
        `¡Hola *${nombre}*! 👋\n\n` +
        `Este es un recordatorio de tu cita en *Cristina Spa*:\n\n` +
        `📅 *Fecha:* ${fecha}\n` +
        `⏰ *Hora:* ${hora}\n` +
        `💅 *Servicios:* ${servicios}` +
        empleado +
        notas +
        `\n\n¿Tienes alguna duda? Responde a este mensaje. ✨`
      );
  }
}

/**
 * Recordatorio "manda ahora" — a diferencia de recordatorio_24h/1h (que asumen
 * un tiempo fijo), este calcula cuánto falta de verdad en el momento del envío
 * y redacta la frase acorde ("mañana", "en 3 días", "en 2 horas", "hoy").
 */
function buildDynamicReminderMessage(cita: {
  fecha: string;
  hora: string;
  cliente: { nombre: string; apellido: string };
  servicios?: string[];
  empleado?: string;
  notas?: string;
}): string {
  const nombre = `${cita.cliente.nombre} ${cita.cliente.apellido}`.trim();
  const fecha = formatFecha(cita.fecha);
  const hora = cita.hora;
  const servicios =
    cita.servicios && cita.servicios.length > 0
      ? cita.servicios.join(', ')
      : 'servicios agendados';
  const empleado = cita.empleado ? `\n👩 Atendida por: *${cita.empleado}*` : '';
  const notas = cita.notas ? `\n📝 Notas: ${cita.notas}` : '';

  const citaDateTime = new Date(`${cita.fecha}T${cita.hora}:00`);
  const hoursUntil = (citaDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
  const daysUntil = Math.round(hoursUntil / 24);

  let cuando: string;
  if (hoursUntil <= 2) {
    const horas = Math.max(1, Math.round(hoursUntil));
    cuando = `es en aproximadamente ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  } else if (daysUntil <= 0) {
    cuando = `es *hoy* a las ${hora}`;
  } else if (daysUntil === 1) {
    cuando = `es *mañana*`;
  } else {
    cuando = `es en *${daysUntil} días*`;
  }

  return (
    `¡Hola *${nombre}*! 👋\n\n` +
    `Te recordamos que tu cita en *Cristina Spa* ${cuando}:\n\n` +
    `📅 *Fecha:* ${fecha}\n` +
    `⏰ *Hora:* ${hora}\n` +
    `💅 *Servicios:* ${servicios}` +
    empleado +
    notas +
    `\n\n¿Vas a poder asistir?\n` +
    `Responde *1* para ✅ Confirmar\n` +
    `Responde *2* para ❌ Cancelar`
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePhone(telefono: string): string {
  // Elimina espacios, guiones, paréntesis, +
  let cleaned = telefono.replace(/[\s\-().+]/g, '');

  // Prefijo de discado internacional "00" (ej. 00591...)
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
  }

  // Los celulares bolivianos tienen 8 dígitos y empiezan con 6 o 7. Laravel
  // no siempre manda el código de país (591) por delante — se lo anteponemos,
  // si no, WhatsApp no reconoce el número y el mensaje nunca llega.
  if (cleaned.length === 8 && /^[67]/.test(cleaned)) {
    cleaned = `591${cleaned}`;
  }

  return cleaned;
}

function clientDisplayName(cliente: {
  nombre: string;
  apellido: string;
}): string {
  return `${cliente.nombre} ${cliente.apellido}`.trim();
}

function citaSnapshot(cita: CitaPayload): CitaSnapshot {
  return {
    fecha: cita.fecha,
    hora: cita.hora,
    servicios: cita.servicios,
    empleado: cita.empleado,
  };
}

function returnError(req: Request, res: Response, error: any) {
  req.logger.error(error);
  res.status(500).json({
    status: 'error',
    message: 'Error al enviar el recordatorio.',
    error: String(error),
  });
}

// ─── Controladores ───────────────────────────────────────────────────────────

/**
 * POST /api/:session/citas/send-reminder
 *
 * Envía un recordatorio de cita a un cliente.
 *
 * Body:
 * {
 *   "cita": {
 *     "id": 42,
 *     "fecha": "2026-03-20",
 *     "hora": "14:30",
 *     "estado": "confirmada",
 *     "cliente": {
 *       "nombre": "María",
 *       "apellido": "García",
 *       "telefono": "5219991234567"
 *     },
 *     "servicios": ["Manicure", "Pedicure"],
 *     "empleado": "Ana López",   // opcional
 *     "notas": "Traer esmalte propio" // opcional
 *   },
 *   "template": "recordatorio_24h"  // opcional, default: "default"
 * }
 */
export async function sendCitaReminder(req: Request, res: Response) {
  /**
   * #swagger.tags = ["Citas"]
     #swagger.summary = "Envía un recordatorio de cita por WhatsApp"
     #swagger.security = [{ "bearerAuth": [] }]
     #swagger.parameters["session"] = { schema: 'citas' }
     #swagger.requestBody = {
       required: true,
       "@content": {
         "application/json": {
           schema: {
             type: "object",
             required: ["cita"],
             properties: {
               cita: {
                 type: "object",
                 required: ["fecha", "hora", "cliente"],
                 properties: {
                   id:           { type: "number" },
                   fecha:        { type: "string", example: "2026-03-20" },
                   hora:         { type: "string", example: "14:30" },
                   estado:       { type: "string", example: "confirmada" },
                   cliente: {
                     type: "object",
                     required: ["nombre", "apellido", "telefono"],
                     properties: {
                       nombre:   { type: "string" },
                       apellido: { type: "string" },
                       telefono: { type: "string", example: "5219991234567" }
                     }
                   },
                   servicios:    { type: "array", items: { type: "string" } },
                   empleado:     { type: "string" },
                   notas:        { type: "string" }
                 }
               },
               template: {
                 type: "string",
                 enum: ["default", "recordatorio_24h", "recordatorio_1h", "confirmacion", "cancelacion"],
                 default: "default"
               }
             }
           }
         }
       }
     }
   */
  const { cita, template = 'default' } = req.body as {
    cita: CitaPayload;
    template?: TemplateKey;
  };

  if (!cita || !cita.cliente || !cita.cliente.telefono) {
    return res.status(400).json({
      status: 'error',
      message: 'Faltan datos requeridos: cita.cliente.telefono es obligatorio.',
    });
  }

  if (!cita.fecha || !cita.hora) {
    return res.status(400).json({
      status: 'error',
      message:
        'Faltan datos requeridos: cita.fecha y cita.hora son obligatorios.',
    });
  }

  const phone = normalizePhone(cita.cliente.telefono);
  const message = buildMessage(cita, template as TemplateKey);

  try {
    const outcome = await guardedSendText(
      req.client,
      phone,
      message,
      req.logger
    );

    if (!outcome.sent) {
      recordSentMessage({
        phone,
        nombre: clientDisplayName(cita.cliente),
        cita_id: cita.id ?? null,
        template,
        trigger: 'inmediato',
        status: 'paused',
        timestamp: new Date().toISOString(),
        cita: citaSnapshot(cita),
      });
      return res.status(200).json({
        status: 'paused',
        message: 'Los envíos están pausados — el mensaje no se mandó.',
        cita_id: cita.id ?? null,
        phone,
      });
    }

    const result = outcome.result;

    if (CONFIRM_TEMPLATES.includes(template as TemplateKey)) {
      setConversation(
        phone,
        'esperando_confirmacion',
        cita.id ?? null,
        clientDisplayName(cita.cliente)
      );

      try {
        const toRaw: string =
          (result as any)?.to || (result as any)?.chatId?._serialized || '';
        if (toRaw.includes('@lid')) {
          registerLid(toRaw.replace('@lid', ''), phone);
        }
      } catch {
        // no crítico — solo afecta la resolución de LID en la respuesta del cliente
      }
    }

    req.logger.info(
      `[Citas] Recordatorio enviado a ${phone} — cita #${cita.id ?? 'N/A'}`
    );
    recordSentMessage({
      phone,
      nombre: clientDisplayName(cita.cliente),
      cita_id: cita.id ?? null,
      template,
      trigger: 'inmediato',
      status: 'success',
      timestamp: new Date().toISOString(),
      cita: citaSnapshot(cita),
    });

    return res.status(201).json({
      status: 'success',
      cita_id: cita.id ?? null,
      phone,
      template,
      message_sent: message,
      response: result,
    });
  } catch (error) {
    recordSentMessage({
      phone,
      nombre: clientDisplayName(cita.cliente),
      cita_id: cita.id ?? null,
      template,
      trigger: 'inmediato',
      status: 'failed',
      error: String(error),
      timestamp: new Date().toISOString(),
      cita: citaSnapshot(cita),
    });
    returnError(req, res, error);
  }
}

/**
 * POST /api/:session/citas/send-bulk-reminders
 *
 * Envía recordatorios a múltiples citas. Ideal para correr desde un cron job de Laravel.
 *
 * Body:
 * {
 *   "reminders": [
 *     {
 *       "cita": { ...CitaPayload },
 *       "template": "recordatorio_24h"
 *     },
 *     ...
 *   ]
 * }
 */
export async function sendBulkCitaReminders(req: Request, res: Response) {
  /**
   * #swagger.tags = ["Citas"]
     #swagger.summary = "Envía recordatorios de citas en lote (bulk)"
     #swagger.security = [{ "bearerAuth": [] }]
     #swagger.parameters["session"] = { schema: 'citas' }
     #swagger.requestBody = {
       required: true,
       "@content": {
         "application/json": {
           schema: {
             type: "object",
             required: ["reminders"],
             properties: {
               reminders: {
                 type: "array",
                 items: {
                   type: "object",
                   required: ["cita"],
                   properties: {
                     cita:     { type: "object" },
                     template: { type: "string" }
                   }
                 }
               },
               delay_ms: {
                 type: "number",
                 description: "Espera entre mensajes en milisegundos (default: 1500)",
                 default: 1500
               }
             }
           }
         }
       }
     }
   */
  const { reminders, delay_ms = 1500 } = req.body as {
    reminders: Array<{ cita: CitaPayload; template?: TemplateKey }>;
    delay_ms?: number;
  };

  if (!Array.isArray(reminders) || reminders.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'El campo "reminders" debe ser un array no vacío.',
    });
  }

  if (isPaused()) {
    return res.status(200).json({
      status: 'paused',
      message: 'Los envíos están pausados — no se mandó ningún mensaje.',
      total: reminders.length,
    });
  }

  const results: Array<{
    cita_id: number | string | null;
    phone: string;
    status: 'sent' | 'failed' | 'paused';
    error?: string;
  }> = [];

  for (const item of reminders) {
    const { cita, template = 'default' } = item;

    if (!cita?.cliente?.telefono || !cita?.fecha || !cita?.hora) {
      results.push({
        cita_id: cita?.id ?? null,
        phone: cita?.cliente?.telefono ?? 'desconocido',
        status: 'failed',
        error: 'Datos incompletos (telefono, fecha u hora faltantes)',
      });
      continue;
    }

    const phone = normalizePhone(cita.cliente.telefono);
    const message = buildMessage(cita, template as TemplateKey);

    // Se revisa en cada mensaje, no solo al empezar el lote — si alguien
    // pausa a mitad de un envío masivo largo, el resto no sigue mandándose.
    if (isPaused()) {
      results.push({ cita_id: cita.id ?? null, phone, status: 'paused' });
      continue;
    }

    try {
      const result = await req.client.sendText(phone, message);

      if (CONFIRM_TEMPLATES.includes(template as TemplateKey)) {
        setConversation(
          phone,
          'esperando_confirmacion',
          cita.id ?? null,
          clientDisplayName(cita.cliente)
        );

        try {
          const toRaw: string =
            (result as any)?.to || (result as any)?.chatId?._serialized || '';
          if (toRaw.includes('@lid')) {
            registerLid(toRaw.replace('@lid', ''), phone);
          }
        } catch {
          // no crítico — solo afecta la resolución de LID en la respuesta del cliente
        }
      }

      req.logger.info(
        `[Citas] Bulk: recordatorio enviado a ${phone} — cita #${
          cita.id ?? 'N/A'
        }`
      );
      recordSentMessage({
        phone,
        nombre: clientDisplayName(cita.cliente),
        cita_id: cita.id ?? null,
        template,
        trigger: 'inmediato',
        status: 'success',
        timestamp: new Date().toISOString(),
        cita: citaSnapshot(cita),
      });

      results.push({
        cita_id: cita.id ?? null,
        phone,
        status: 'sent',
      });
    } catch (error) {
      req.logger.error(`[Citas] Bulk: error al enviar a ${phone} — ${error}`);
      recordSentMessage({
        phone,
        nombre: clientDisplayName(cita.cliente),
        cita_id: cita.id ?? null,
        template,
        trigger: 'inmediato',
        status: 'failed',
        error: String(error),
        timestamp: new Date().toISOString(),
        cita: citaSnapshot(cita),
      });
      results.push({
        cita_id: cita.id ?? null,
        phone,
        status: 'failed',
        error: String(error),
      });
    }

    // Pausa entre mensajes para evitar ban por spam
    if (delay_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay_ms));
    }
  }

  const sent = results.filter((r) => r.status === 'sent').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  return res.status(200).json({
    status: failed === 0 ? 'success' : sent === 0 ? 'error' : 'partial',
    total: reminders.length,
    sent,
    failed,
    results,
  });
}

/**
 * POST /api/:session/citas/schedule-reminder
 *
 * Programa un recordatorio para enviarse en una fecha/hora futura.
 *
 * Body:
 * {
 *   "send_at": "2026-03-20T14:00:00",   // ISO 8601, hora local del servidor
 *   "cita": { ...CitaPayload },
 *   "template": "recordatorio_24h"       // opcional, default: "default"
 * }
 */
export async function scheduleCitaReminder(req: Request, res: Response) {
  const {
    send_at,
    cita,
    template = 'default',
  } = req.body as {
    send_at: string;
    cita: CitaPayload;
    template?: TemplateKey;
  };

  if (!send_at) {
    return res.status(400).json({
      status: 'error',
      message:
        'El campo "send_at" es obligatorio (ISO 8601, ej: "2026-03-20T14:00:00").',
    });
  }

  if (!cita || !cita.cliente?.telefono || !cita.fecha || !cita.hora) {
    return res.status(400).json({
      status: 'error',
      message:
        'Faltan datos requeridos: cita.cliente.telefono, cita.fecha y cita.hora.',
    });
  }

  const sendAt = new Date(send_at);
  if (isNaN(sendAt.getTime()) || sendAt <= new Date()) {
    return res.status(400).json({
      status: 'error',
      message:
        '"send_at" debe ser una fecha futura válida en formato ISO 8601.',
    });
  }

  const phone = normalizePhone(cita.cliente.telefono);
  const message = buildMessage(cita, template as TemplateKey);
  const session = req.params.session;

  const reminder = addReminder({
    session,
    send_at: sendAt.toISOString(),
    phone,
    message,
    template,
    cita_id: cita.id ?? null,
  });

  req.logger.info(
    `[Citas] Recordatorio programado para ${sendAt.toISOString()} → ${phone} (cita #${
      cita.id ?? 'N/A'
    })`
  );

  return res.status(201).json({
    status: 'scheduled',
    reminder_id: reminder.id,
    phone,
    send_at: reminder.send_at,
    template,
    message_preview: message,
  });
}

/**
 * GET /api/:session/citas/scheduled-reminders
 *
 * Lista todos los recordatorios pendientes.
 */
/**
 * GET /api/:session/citas/active-conversations
 *
 * Debug — muestra las conversaciones activas en memoria.
 */
export function getActiveConversations(_req: Request, res: Response) {
  const convs = listConversations();
  return res.status(200).json({
    status: 'success',
    total: convs.length,
    conversations: convs,
  });
}

export function getScheduledReminders(_req: Request, res: Response) {
  const reminders = listReminders();
  return res.status(200).json({
    status: 'success',
    total: reminders.length,
    reminders,
  });
}

/**
 * POST /api/:session/citas/process-cita
 *
 * Endpoint unificado. Laravel llama esto siempre que una cita cambia de estado.
 * El servidor decide qué hacer según el estado:
 *
 *   confirmada → envío inmediato template "confirmacion" + programa
 *                recordatorio_24h y recordatorio_1h (si hay tiempo)
 *   pendiente  → sin acción (el cliente todavía no confirmó)
 *   completada → sin acción
 *   cancelada  → sin acción
 *
 * Body:
 * {
 *   "cita": {
 *     "id": 15,
 *     "fecha": "2026-04-10",
 *     "hora": "10:00",
 *     "estado": "confirmada",
 *     "cliente": { "nombre": "María", "apellido": "García", "telefono": "59176543210" },
 *     "servicios": ["Corte de Cabello"],
 *     "empleado": "Ana López",
 *     "notas": null
 *   }
 * }
 */
export async function processCita(req: Request, res: Response) {
  const { cita } = req.body as { cita: CitaPayload };

  if (
    !cita ||
    !cita.estado ||
    !cita.cliente?.telefono ||
    !cita.fecha ||
    !cita.hora
  ) {
    return res.status(400).json({
      status: 'error',
      message:
        'Faltan datos requeridos: cita.estado, cita.fecha, cita.hora y cita.cliente.telefono.',
    });
  }

  // accion "eliminada": la cita se borró en el admin — cancelar recordatorios
  // pendientes y cualquier conversación activa, sin mandar mensaje al cliente.
  if (cita.accion === 'eliminada') {
    removeRemindersForCita(cita.id ?? null);
    clearConversationForCita(cita.id ?? null);
    req.logger.info(
      `[Citas] processCita: cita #${
        cita.id ?? 'N/A'
      } eliminada — recordatorios y conversación cancelados.`
    );
    return res.status(200).json({
      status: 'no_action',
      action: 'eliminada',
      message: 'Cita eliminada — recordatorios cancelados.',
      cita_id: cita.id ?? null,
    });
  }

  const estado = cita.estado.toLowerCase();

  // Estados que no generan ninguna acción — "pendiente" significa que el
  // cliente todavía no confirmó, así que no hay nada que recordarle todavía;
  // los recordatorios recién se programan cuando pasa a "confirmada".
  if (
    estado === 'completada' ||
    estado === 'cancelada' ||
    estado === 'pendiente'
  ) {
    req.logger.info(
      `[Citas] processCita: estado "${estado}" — sin acción para cita #${
        cita.id ?? 'N/A'
      }`
    );
    return res.status(200).json({
      status: 'no_action',
      message: `Estado "${estado}" no genera envío de mensajes.`,
      cita_id: cita.id ?? null,
    });
  }

  const phone = normalizePhone(cita.cliente.telefono);
  const session = req.params.session;

  // ── confirmada: aviso inmediato + programar recordatorios 24h y 1h ───────
  if (estado === 'confirmada') {
    // Evita duplicados si esta cita ya se procesó antes (ej. Laravel reenvía
    // el webhook, o se reprograma fecha/hora manteniendo el mismo estado).
    removeRemindersForCita(cita.id ?? null);

    const citaDateTime = new Date(`${cita.fecha}T${cita.hora}:00`);
    const now = new Date();
    const scheduled: string[] = [];

    const at24h = new Date(citaDateTime.getTime() - 24 * 60 * 60 * 1000);
    const at1h = new Date(citaDateTime.getTime() - 60 * 60 * 1000);

    const citaContext = {
      fecha: cita.fecha,
      hora: cita.hora,
      cliente: { nombre: cita.cliente.nombre, apellido: cita.cliente.apellido },
      servicios: cita.servicios,
      empleado: cita.empleado,
      notas: cita.notas,
    };

    if (at24h > now) {
      const message24h = buildMessage(cita, 'recordatorio_24h');
      addReminder({
        session,
        send_at: at24h.toISOString(),
        phone,
        message: message24h,
        template: 'recordatorio_24h',
        cita_id: cita.id ?? null,
        cita: citaContext,
      });
      scheduled.push('recordatorio_24h');
      req.logger.info(
        `[Citas] Recordatorio 24h programado para ${at24h.toISOString()} → ${phone} — cita #${
          cita.id ?? 'N/A'
        }`
      );
    }

    if (at1h > now) {
      const message1h = buildMessage(cita, 'recordatorio_1h');
      addReminder({
        session,
        send_at: at1h.toISOString(),
        phone,
        message: message1h,
        template: 'recordatorio_1h',
        cita_id: cita.id ?? null,
        cita: citaContext,
      });
      scheduled.push('recordatorio_1h');
      req.logger.info(
        `[Citas] Recordatorio 1h programado para ${at1h.toISOString()} → ${phone} — cita #${
          cita.id ?? 'N/A'
        }`
      );
    }

    const message = buildMessage(cita, 'confirmacion');
    try {
      const outcome = await guardedSendText(
        req.client,
        phone,
        message,
        req.logger
      );

      if (!outcome.sent) {
        recordSentMessage({
          phone,
          nombre: clientDisplayName(cita.cliente),
          cita_id: cita.id ?? null,
          template: 'confirmacion',
          trigger: 'inmediato',
          status: 'paused',
          timestamp: new Date().toISOString(),
          cita: citaSnapshot(cita),
        });
        return res.status(200).json({
          status: 'paused',
          message:
            'Los envíos están pausados — el mensaje no se mandó, pero los recordatorios sí quedaron programados.',
          cita_id: cita.id ?? null,
          phone,
          scheduled,
        });
      }

      const result = outcome.result;

      req.logger.info(
        `[Citas] Confirmación enviada a ${phone} — cita #${cita.id ?? 'N/A'}`
      );
      recordSentMessage({
        phone,
        nombre: clientDisplayName(cita.cliente),
        cita_id: cita.id ?? null,
        template: 'confirmacion',
        trigger: 'inmediato',
        status: 'success',
        timestamp: new Date().toISOString(),
        cita: citaSnapshot(cita),
      });

      return res.status(201).json({
        status: 'success',
        action: 'sent',
        template: 'confirmacion',
        cita_id: cita.id ?? null,
        phone,
        response: result,
        scheduled,
      });
    } catch (error) {
      recordSentMessage({
        phone,
        nombre: clientDisplayName(cita.cliente),
        cita_id: cita.id ?? null,
        template: 'confirmacion',
        trigger: 'inmediato',
        status: 'failed',
        error: String(error),
        timestamp: new Date().toISOString(),
        cita: citaSnapshot(cita),
      });
      return returnError(req, res, error);
    }
  }

  return res.status(400).json({
    status: 'error',
    message: `Estado "${cita.estado}" no reconocido. Use: confirmada, pendiente, completada, cancelada.`,
  });
}

/**
 * DELETE /api/:session/citas/scheduled-reminders/:reminderId
 *
 * Cancela un recordatorio programado.
 */
export function cancelScheduledReminder(req: Request, res: Response) {
  const { reminderId } = req.params;
  const deleted = deleteReminder(reminderId);

  if (!deleted) {
    return res.status(404).json({
      status: 'error',
      message: `No se encontró un recordatorio con id "${reminderId}".`,
    });
  }

  return res.status(200).json({
    status: 'success',
    message: `Recordatorio "${reminderId}" cancelado.`,
  });
}

/**
 * POST /api/admin/citas/scheduled-reminders/:reminderId/send-now
 *
 * Envía una copia de un recordatorio pendiente ahora mismo, sin esperar a su
 * hora programada. Si se guardó el contexto de la cita, recalcula el mensaje
 * con el tiempo real restante ("mañana", "en 3 días", "en 2 horas"...) en vez
 * de usar el texto fijo de la plantilla original (que asumía 24h/1h exactas).
 *
 * Es un envío adicional: el recordatorio original (24h o 1h) NO se elimina
 * de la cola y sigue su curso normal en su horario programado.
 */
export async function sendReminderNow(req: Request, res: Response) {
  const { reminderId } = req.params;
  const reminder = listReminders().find((r) => r.id === reminderId);

  if (!reminder) {
    return res.status(404).json({
      status: 'error',
      message: `No se encontró un recordatorio con id "${reminderId}".`,
    });
  }

  const nombre = reminder.cita
    ? clientDisplayName(reminder.cita.cliente)
    : undefined;

  const citaInfo: CitaSnapshot | undefined = reminder.cita
    ? {
        fecha: reminder.cita.fecha,
        hora: reminder.cita.hora,
        servicios: reminder.cita.servicios,
        empleado: reminder.cita.empleado,
      }
    : undefined;

  const message = reminder.cita
    ? buildDynamicReminderMessage({
        fecha: reminder.cita.fecha,
        hora: reminder.cita.hora,
        cliente: reminder.cita.cliente,
        servicios: reminder.cita.servicios,
        empleado: reminder.cita.empleado,
        notas: reminder.cita.notas,
      })
    : reminder.message;

  try {
    const outcome = await guardedSendText(
      req.client,
      reminder.phone,
      message,
      req.logger
    );

    if (!outcome.sent) {
      recordSentMessage({
        phone: reminder.phone,
        nombre,
        cita_id: reminder.cita_id ?? null,
        template: reminder.template ?? 'recordatorio',
        trigger: 'recordatorio',
        status: 'paused',
        timestamp: new Date().toISOString(),
        cita: citaInfo,
      });
      return res.status(200).json({
        status: 'paused',
        message: 'Los envíos están pausados — el mensaje no se mandó.',
        phone: reminder.phone,
      });
    }

    const result = outcome.result;
    // No se borra de la cola: el envío manual es un mensaje extra, el
    // recordatorio 24h/1h original se mantiene y sigue su curso normal.
    setConversation(
      reminder.phone,
      'esperando_confirmacion',
      reminder.cita_id ?? null,
      nombre
    );

    try {
      const toRaw: string =
        (result as any)?.to || (result as any)?.chatId?._serialized || '';
      if (toRaw.includes('@lid')) {
        registerLid(toRaw.replace('@lid', ''), reminder.phone);
      }
    } catch {
      // no crítico — solo afecta la resolución de LID en la respuesta del cliente
    }

    req.logger.info(
      `[Citas] Recordatorio "${reminderId}" enviado manualmente a ${
        reminder.phone
      } — cita #${reminder.cita_id ?? 'N/A'}`
    );
    recordSentMessage({
      phone: reminder.phone,
      nombre,
      cita_id: reminder.cita_id ?? null,
      template: reminder.template ?? 'recordatorio',
      trigger: 'recordatorio',
      status: 'success',
      timestamp: new Date().toISOString(),
      cita: citaInfo,
    });

    return res.status(200).json({
      status: 'success',
      phone: reminder.phone,
      message_sent: message,
      response: result,
    });
  } catch (error) {
    recordSentMessage({
      phone: reminder.phone,
      nombre,
      cita_id: reminder.cita_id ?? null,
      template: reminder.template ?? 'recordatorio',
      trigger: 'recordatorio',
      status: 'failed',
      error: String(error),
      timestamp: new Date().toISOString(),
      cita: citaInfo,
    });
    return returnError(req, res, error);
  }
}
