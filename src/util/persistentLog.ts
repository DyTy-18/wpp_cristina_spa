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
 * Historial simple respaldado en un archivo JSON — mismo patrón que
 * citasScheduler.ts usa para scheduled-reminders.json. Sin esto, los logs
 * de mensajes enviados/respuestas de clientes vivían solo en memoria y
 * desaparecían con cada reinicio del servidor.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function createPersistentLog<T>(filename: string, maxEntries: number) {
  const filePath = path.join(DATA_DIR, filename);

  function read(): T[] {
    try {
      if (!fs.existsSync(filePath)) return [];
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T[];
    } catch {
      return [];
    }
  }

  function write(entries: T[]): void {
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  return {
    record(entry: T): void {
      const entries = read();
      entries.unshift(entry);
      if (entries.length > maxEntries) entries.length = maxEntries;
      write(entries);
    },
    list(): T[] {
      return read();
    },
  };
}
