// Invites & members client (contract: shared/contracts.ts "Invites & members").
import type { InviteInfo, InvitePreview, InviteRole, Member } from '@shared/contracts';
import { api } from '@/lib/api';

export const InviteAPI = {
  create: (eventId: string, b: { role: InviteRole; teamId?: string | null; maxUses?: number | null; expiresInHours?: number | null; note?: string | null }) =>
    api<{ invite: InviteInfo; url: string }>(`/api/events/${eventId}/invites`, { body: b }),
  list: (eventId: string) => api<{ invites: InviteInfo[] }>(`/api/events/${eventId}/invites`),
  revoke: (inviteId: string) => api<{ ok: true }>(`/api/invites/${inviteId}`, { method: 'DELETE' }),
  preview: (token: string) => api<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`),
  /** Signed out + staff invite: pass `name` (QR-only staff, no account). */
  accept: (token: string, name?: string | null) => api<{ eventId: string; role: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, { body: name ? { name } : {} }),
  /** Signed out: pass `name` (QR-only staff, no account). */
  joinByCode: (code: string, teamId?: string | null, name?: string | null) => api<{ eventId: string; role: string }>('/api/events/join-by-code', { body: { code, as: 'staff', teamId, ...(name ? { name } : {}) } }),
  teamsForCode: (code: string) => api<{ teams: Array<{ id: string; name: string }> }>(`/api/events/code/${encodeURIComponent(code)}/teams`),
  members: (eventId: string) => api<{ members: Member[] }>(`/api/events/${eventId}/members`),
  addMember: (eventId: string, b: { username: string; role: InviteRole; teamId?: string | null }) => api<{ member: Member }>(`/api/events/${eventId}/members`, { body: b }),
};

/** Where to land after joining: staff work from the phone app; organizers on desktop go to the dashboard. */
export function landingFor(eventId: string, role: string): string {
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  if (role === 'admin' && !narrow) return `/e/${eventId}/dashboard`;
  return `/staff?event=${encodeURIComponent(eventId)}`;
}
