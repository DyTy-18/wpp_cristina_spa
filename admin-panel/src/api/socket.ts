import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Socket.io compartido con el resto del server (ya se usa para eventos de
 * WhatsApp). El backend emite "citas:update" cada vez que algo cambia
 * (recordatorio programado/enviado/cancelado, respuesta de un cliente) para
 * que el panel se refresque solo, sin depender de recargar la página.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_BASE_URL, {
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}
