// Preset + install-slot calls (self-contained; uses the shared `api` fetch helper).
import type { Device, EventInfo, InstallSlot, Me, VenueMapInfo, Zone } from '@shared/contracts';
import { api } from '@/lib/api';

export const presetApi = {
  apply: (eventId: string, presetId: string) => api<{ map: VenueMapInfo; zones: Zone[] }>(`/api/events/${eventId}/map/preset`, { body: { presetId } }),
  slot: (code: string, slotId: string) => api<{ event: EventInfo; slot: InstallSlot }>(`/api/presets/slot/${encodeURIComponent(code)}/${encodeURIComponent(slotId)}`),
  join: (code: string, slot: InstallSlot) =>
    api<{ me: Me; device: Device }>('/api/join', { body: { code, as: slot.kind === 'scribe' ? 'scribe' : 'camera', slot: slot.id } }),
};

/** One-scan setup link for a slot (camera / scribe). Posters point attendees at the chat instead. */
export function slotUrl(origin: string, joinCode: string, slot: InstallSlot): string {
  return slot.kind === 'poster' ? `${origin}/j/${joinCode}?as=guest` : `${origin}/s/${joinCode}/${slot.id}`;
}
