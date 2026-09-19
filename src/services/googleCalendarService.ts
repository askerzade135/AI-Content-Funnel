import { connectGoogleCalendar, getCalendarAccessToken } from './googleAuth';

const CALENDAR_NAME = 'Content Radar';

export interface CalendarEventInput {
  title: string;
  description?: string;
  scheduledAt: string;
  publicationPlatform?: string;
  durationMinutes?: number;
}

export interface CalendarEventResult {
  calendarId: string;
  eventId: string;
  url?: string;
}

async function getToken(): Promise<string> {
  let token = await getCalendarAccessToken();
  if (!token) {
    const connected = await connectGoogleCalendar();
    token = connected?.accessToken || null;
  }
  if (!token) throw new Error('Google Calendar connection cancelled');
  return token;
}

async function googleRequest(path: string, init: RequestInit = {}) {
  const token = await getToken();
  const response = await fetch('https://www.googleapis.com/calendar/v3' + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Calendar API ${response.status}: ${body.slice(0, 500)}`);
  }
  return response;
}

export async function getOrCreateContentRadarCalendar(): Promise<string> {
  const listResponse = await googleRequest('/users/me/calendarList?maxResults=250');
  const list = await listResponse.json();
  const existing = Array.isArray(list?.items)
    ? list.items.find((item: any) => item?.summary === CALENDAR_NAME && ['owner', 'writer'].includes(item?.accessRole))
    : null;
  if (existing?.id) return existing.id;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const createResponse = await googleRequest('/calendars', {
    method: 'POST',
    body: JSON.stringify({
      summary: CALENDAR_NAME,
      description: 'Publication schedule created by Content Radar',
      timeZone: timezone,
    }),
  });
  const created = await createResponse.json();
  if (!created?.id) throw new Error('Google Calendar did not return a calendar id');
  return created.id;
}

export async function createContentRadarCalendarEvent(input: CalendarEventInput): Promise<CalendarEventResult> {
  const calendarId = await getOrCreateContentRadarCalendar();
  const start = new Date(input.scheduledAt);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid schedule date');
  const end = new Date(start.getTime() + (input.durationMinutes || 30) * 60_000);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const response = await googleRequest('/calendars/' + encodeURIComponent(calendarId) + '/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: input.title,
      description: [
        input.publicationPlatform ? 'Platform: ' + input.publicationPlatform : '',
        input.description || '',
        'Scheduled by Content Radar',
      ].filter(Boolean).join('\n\n'),
      start: { dateTime: start.toISOString(), timeZone: timezone },
      end: { dateTime: end.toISOString(), timeZone: timezone },
    }),
  });
  const event = await response.json();
  return {
    calendarId,
    eventId: event.id,
    url: event.htmlLink,
  };
}

export async function deleteContentRadarCalendarEvent(calendarId: string, eventId: string): Promise<void> {
  await googleRequest('/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId), {
    method: 'DELETE',
  });
}
