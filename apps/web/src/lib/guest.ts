// Persistent guest identity. A random id lives in the browser's cache
// (localStorage) so a guest keeps the same identity across visits on this
// device. The server also records the IP as a secondary signal — IPs alone
// are unreliable (shared mobile/hostel networks, dynamic addresses).

const KEY = 'chitchat:guest_id';

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function getGuestId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(KEY);
    if (!id || id.length < 8 || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
      id = randomId();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}
