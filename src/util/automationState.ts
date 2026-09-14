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
import fs from 'fs';
import path from 'path';
import { Logger } from 'winston';

import { emitCitasUpdate } from './realtime';

/**
 * Interruptor global de emergencia — pausa el ENVÍO de mensajes de WhatsApp
 * sin tocar nada más: Laravel puede seguir llamando a la API, las citas se
 * siguen programando, las respuestas de clientes se siguen procesando y
 * notificando a Laravel. Solo el `client.sendText(...)` final queda bloqueado
 * mientras está pausado.
 *
 * Se guarda en disco (no solo en memoria) para que un restart del servidor
 * no reactive los envíos sin que alguien lo decida explícitamente.
 */

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'automation-state.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface AutomationState {
  paused: boolean;
  updatedAt: string;
}

function readState(): AutomationState {
  try {
    if (!fs.existsSync(STATE_FILE)) return { paused: false, updatedAt: '' };
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { paused: false, updatedAt: '' };
  }
}

export function isPaused(): boolean {
  return readState().paused;
}

export function getAutomationState(): AutomationState {
  return readState();
}

export function setPaused(paused: boolean): void {
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ paused, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );
  emitCitasUpdate();
}

export interface SendOutcome {
  sent: boolean;
  result?: any;
}

/**
 * Reemplaza a `client.sendText(...)` en todos los puntos de envío de citas.
 * Si la automatización está pausada, no llama a WhatsApp — solo loguea y
 * devuelve `sent: false` para que el que llama decida cómo registrarlo.
 */
export async function guardedSendText(
  client: any,
  phone: string,
  message: string,
  logger: Logger
): Promise<SendOutcome> {
  if (isPaused()) {
    logger.warn(`[Automation] Envíos pausados — no se mandó nada a ${phone}.`);
    return { sent: false };
  }
  const result = await client.sendText(phone, message);
  return { sent: true, result };
}
