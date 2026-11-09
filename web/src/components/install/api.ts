// Preset + install-slot calls (self-contained; uses the shared `api` fetch helper).
import type { Device, EventInfo, InstallSlot, Me, VenueMapInfo, Zone } from '@shared/contracts';
import { api } from '@/lib/api';
import { withKey } from '@/lib/links';

export const presetApi = {
  apply: (eventId: string, presetId: string) => api<{ map: VenueMapInfo; zones: Zone[] }>(`/api/events/${eventId}/map/preset`, { body: { presetId } }),
  slot: (code: string, slotId: string) => api<{ event: EventInfo; slot: InstallSlot }>(`/api/presets/slot/${encodeURIComponent(code)}/${encodeURIComponent(slotId)}`),
  join: (code: string, slot: InstallSlot, key?: string | null) =>
    api<{ me: Me; device: Device }>('/api/join', { body: { code, as: slot.kind === 'scribe' ? 'scribe' : 'camera', slot: slot.id, key: key ?? null } }),
};

/** One-scan setup link for a slot (camera / scribe, with the organizer's join key). Posters point attendees at the chat instead. */
export function slotUrl(origin: string, joinCode: string, slot: InstallSlot, joinKey?: string | null): string {
  return slot.kind === 'poster' ? `${origin}/j/${joinCode}?as=guest` : withKey(`${origin}/s/${joinCode}/${slot.id}`, joinKey);
}
