// Google Calendar API Service
// Handles OAuth, calendar operations, and push notifications

export interface GoogleCalendar {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
}

export interface GoogleCalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string; // ISO 8601
    date?: string; // All-day events
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
  }>;
  location?: string;
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
  extendedProperties?: {
    private?: {
      [key: string]: string;
    };
  };
  updated?: string; // ISO 8601 timestamp
}

export interface WatchChannel {
  id: string;
  type: 'web_hook';
  address: string;
  token?: string;
  expiration?: number; // Unix timestamp in milliseconds
}

export interface WatchResponse {
  kind: 'api#channel';
  id: string;
  resourceId: string;
  resourceUri: string;
  token?: string;
  expiration?: string; // Unix timestamp in milliseconds
}

export class GoogleCalendarService {
  private accessToken: string;
  private refreshToken?: string;
  private clientId: string;
  private clientSecret: string;

  constructor(accessToken: string, refreshToken?: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    // These should come from environment variables (single project for all restaurants)
    this.clientId = process.env.GOOGLE_CLIENT_ID || '';
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  /**
   * Make authenticated request to Google Calendar API
   * Automatically refreshes token if needed
   */
  private async apiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    let response = await fetch(`https://www.googleapis.com/calendar/v3${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // If unauthorized, try refreshing token once
    if (response.status === 401 && this.refreshToken) {
      await this.refreshAccessToken();
      response = await fetch(`https://www.googleapis.com/calendar/v3${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    }

    return response;
  }

  /**
   * List user's calendars
   */
  async getCalendars(): Promise<GoogleCalendar[]> {
    try {
      const response = await this.apiRequest('/users/me/calendarList');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch calendars: ${response.statusText}`);
      }

      const data = await response.json();
      return (data.items || []).map((item: any) => ({
        id: item.id,
        summary: item.summary,
        description: item.description,
        timeZone: item.timeZone,
        primary: item.primary || false,
      }));
    } catch (error) {
      console.error('Error fetching calendars:', error);
      throw error;
    }
  }

  /**
   * Get calendar event by ID
   */
  async getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent> {
    try {
      const response = await this.apiRequest(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch event: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching event:', error);
      throw error;
    }
  }

  /**
   * Create calendar event from reservation
   */
  async createEvent(calendarId: string, event: GoogleCalendarEvent): Promise<GoogleCalendarEvent> {
    try {
      const response = await this.apiRequest(
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          body: JSON.stringify(event),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to create event: ${error.error?.message || response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating event:', error);
      throw error;
    }
  }

  /**
   * Update calendar event
   */
  async updateEvent(calendarId: string, eventId: string, event: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent> {
    try {
      const response = await this.apiRequest(
        `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
        {
          method: 'PUT',
          body: JSON.stringify(event),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to update event: ${error.error?.message || response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error updating event:', error);
      throw error;
    }
  }

  /**
   * Delete calendar event
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      const response = await this.apiRequest(
        `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to delete event: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      throw error;
    }
  }

  /**
   * Set up push notification channel (watch) for calendar events
   */
  async watchEvents(calendarId: string, channel: WatchChannel): Promise<WatchResponse> {
    try {
      const response = await this.apiRequest(
        `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
        {
          method: 'POST',
          body: JSON.stringify(channel),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to create watch: ${error.error?.message || response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating watch:', error);
      throw error;
    }
  }

  /**
   * Stop a watch channel
   */
  async stopWatch(channelId: string, resourceId: string): Promise<void> {
    try {
      const response = await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: channelId,
          resourceId: resourceId,
        }),
      });

      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to stop watch: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error stopping watch:', error);
      throw error;
    }
  }

  /**
   * List events in a calendar within a time range
   */
  async listEvents(
    calendarId: string,
    options: {
      timeMin?: string; // ISO 8601
      timeMax?: string; // ISO 8601
      maxResults?: number;
      singleEvents?: boolean;
      orderBy?: 'startTime' | 'updated';
    } = {}
  ): Promise<GoogleCalendarEvent[]> {
    try {
      const params = new URLSearchParams();
      if (options.timeMin) params.append('timeMin', options.timeMin);
      if (options.timeMax) params.append('timeMax', options.timeMax);
      if (options.maxResults) params.append('maxResults', options.maxResults.toString());
      if (options.singleEvents) params.append('singleEvents', 'true');
      if (options.orderBy) params.append('orderBy', options.orderBy);

      const response = await this.apiRequest(
        `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`Failed to list events: ${response.statusText}`);
      }

      const data = await response.json();
      return data.items || [];
    } catch (error) {
      console.error('Error listing events:', error);
      throw error;
    }
  }
}

/**
 * Create Google Calendar service instance
 * Fetches and decrypts OAuth tokens from database
 */
export async function createGoogleCalendarService(tenantId: string): Promise<GoogleCalendarService> {
  // This will be called from API routes after fetching encrypted tokens
  // For now, returns a service that needs tokens passed in
  // Actual implementation will fetch from api_keys table
  throw new Error('Use getGoogleCalendarTokens() first, then create service with tokens');
}

/**
 * Helper to convert reservation to Google Calendar event
 */
export function reservationToEvent(reservation: {
  customer_name: string;
  reservation_datetime: string;
  duration_minutes?: number;
  party_size: number;
  phone?: string;
  email?: string;
  customer_notes?: string;
  special_requests?: string;
}): GoogleCalendarEvent {
  const start = new Date(reservation.reservation_datetime);
  const end = new Date(start.getTime() + (reservation.duration_minutes || 120) * 60 * 1000);

  return {
    summary: `Reservation: ${reservation.customer_name} (${reservation.party_size} guests)`,
    description: [
      `Party Size: ${reservation.party_size}`,
      reservation.phone ? `Phone: ${reservation.phone}` : '',
      reservation.email ? `Email: ${reservation.email}` : '',
      reservation.customer_notes ? `Notes: ${reservation.customer_notes}` : '',
      reservation.special_requests ? `Special Requests: ${reservation.special_requests}` : '',
    ].filter(Boolean).join('\n'),
    start: {
      dateTime: start.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    attendees: reservation.email ? [{ email: reservation.email }] : undefined,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 1440 }, // 24 hours before
        { method: 'popup', minutes: 60 }, // 1 hour before
      ],
    },
  };
}

/**
 * Helper to convert Google Calendar event to reservation data
 */
export function eventToReservation(event: GoogleCalendarEvent): {
  customer_name: string;
  reservation_datetime: string;
  duration_minutes: number;
  party_size: number;
  email?: string;
  customer_notes?: string;
} {
  // Extract party size from summary or description
  const partySizeMatch = event.summary?.match(/\((\d+)\s+guests?\)/i) || 
                        event.description?.match(/Party Size:\s*(\d+)/i);
  const partySize = partySizeMatch ? parseInt(partySizeMatch[1]) : 2;

  // Extract customer name from summary
  const nameMatch = event.summary?.match(/Reservation:\s*(.+?)\s*\(/i);
  const customerName = nameMatch ? nameMatch[1].trim() : event.summary || 'Guest';

  // Calculate duration
  const start = event.start.dateTime ? new Date(event.start.dateTime) : 
                event.start.date ? new Date(event.start.date) : new Date();
  const end = event.end.dateTime ? new Date(event.end.dateTime) : 
              event.end.date ? new Date(event.end.date) : new Date(start.getTime() + 120 * 60 * 1000);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / (60 * 1000));

  // Extract email from attendees
  const email = event.attendees?.[0]?.email;

  // Extract notes from description
  const notesMatch = event.description?.match(/Notes:\s*(.+?)(?:\n|$)/i);
  const customerNotes = notesMatch ? notesMatch[1].trim() : event.description;

  return {
    customer_name: customerName,
    reservation_datetime: start.toISOString(),
    duration_minutes: durationMinutes,
    party_size: partySize,
    email,
    customer_notes: customerNotes,
  };
}
