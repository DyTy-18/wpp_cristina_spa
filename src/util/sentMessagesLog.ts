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

import { createPersistentLog } from './persistentLog';
import { emitCitasUpdate } from './realtime';

export interface CitaSnapshot {
  fecha: string;
  hora: string;
  servicios?: string[];
  empleado?: string;
}

export interface SentMessageEntry {
  phone: string;
  nombre?: string;
  cita_id: number | string | null;
  template: string;
  trigger: 'inmediato' | 'recordatorio';
  status: 'success' | 'failed' | 'paused';
  error?: string;
  timestamp: string;
  cita?: CitaSnapshot;
}

const MAX_ENTRIES = 2000;
const log = createPersistentLog<SentMessageEntry>(
  'sent-messages.json',
  MAX_ENTRIES
);

export function recordSentMessage(entry: SentMessageEntry): void {
  log.record(entry);
  emitCitasUpdate();
}

export function listSentMessages(): SentMessageEntry[] {
  return log.list();
}
