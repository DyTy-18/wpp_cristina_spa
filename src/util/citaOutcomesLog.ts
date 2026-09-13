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

/**
 * Registro de lo que respondió el cliente a un recordatorio (confirmó,
 * canceló, o pidió reagendar). La conversación en sí se borra de memoria en
 * cuanto termina (ver citasConversation.ts) — este log es lo único que queda
 * como rastro de esa decisión dentro del panel.
 */

import { emitCitasUpdate } from './realtime';

export type CitaOutcome = 'confirmada' | 'cancelada' | 'reagendar';

export interface CitaOutcomeEntry {
  phone: string;
  nombre?: string;
  cita_id: number | string | null;
  accion: CitaOutcome;
  timestamp: string;
}

const MAX_ENTRIES = 200;
const entries: CitaOutcomeEntry[] = [];

export function recordCitaOutcome(entry: CitaOutcomeEntry): void {
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  emitCitasUpdate();
}

export function listCitaOutcomes(): CitaOutcomeEntry[] {
  return entries;
}
