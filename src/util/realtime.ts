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
import { Server as SocketServer } from 'socket.io';

/**
 * Referencia al servidor de socket.io, para que código fuera del ciclo
 * request/response (el scheduler, los logs en memoria) también pueda avisar
 * al panel de administración que algo cambió, sin depender de polling.
 */
let ioInstance: SocketServer | null = null;

export function setIo(io: SocketServer): void {
  ioInstance = io;
}

/**
 * Avisa a todos los paneles conectados que hay novedades en citas
 * (recordatorio programado/enviado/cancelado, respuesta de un cliente, etc.)
 * para que refresquen sin que alguien tenga que recargar la página.
 */
export function emitCitasUpdate(): void {
  ioInstance?.emit('citas:update');
}
