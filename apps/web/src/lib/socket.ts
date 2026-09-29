// Client-side socket singleton. One connection per page lifetime; pages attach
// and detach their own event listeners.

import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

// Accepts a full URL or a bare host (e.g. Render's fromService `host`
// reference, which has no scheme); bare hosts are treated as https.
export function resolveSocketUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000')
    .trim()
    .replace(/\/$/, '');
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function getSocket(): Socket {
  if (typeof window === 'undefined') throw new Error('getSocket is client-only');
  if (!socket) {
    const url = resolveSocketUrl();
    socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 10_000,
      timeout: 20_000,
    });
  }
  return socket;
}

export function resetSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
