// Tiny event bus decoupling modules (avoids circular imports).
type Emit = (channel: string, payload: unknown) => void;
const listeners: Emit[] = [];

export function onBusEvent(fn: Emit) { listeners.push(fn); }
export function emitBus(channel: string, payload: unknown) { listeners.forEach((fn) => fn(channel, payload)); }
