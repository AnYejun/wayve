// Join links. Staff, camera and scribe links carry the organizer's join key (`k`, from the admin snapshot). The attendee
// link (`?as=guest`, printed on public posters) never does, so the poster code alone cannot join as staff or as a device.
export function withKey(url: string, key: string | null | undefined): string {
  if (!key) return url;
  return `${url}${url.includes('?') ? '&' : '?'}k=${encodeURIComponent(key)}`;
}
