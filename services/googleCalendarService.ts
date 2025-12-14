// Google Calendar API Service
// Handles OAuth2 authentication, calendar operations, and watch channels

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
    date?: string; // YYYY-MM-DD for all-day events
    timeZone?: string;
  };
  end: {
    dateTime?: string; // ISO 8601
    date?: string; // YYYY-MM-DD for all-day events
    timeZone?: string;
  };
  location?: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  }>;
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
  updated?: string; // ISO 8601 timestamp
}

export interface WatchChannel {
  id: string;
  resourceId: string;
  resourceUri: string;
  expiration: string; // Unix timestamp in milliseconds
}

export interface WatchRequest {
  id: string; // Channel ID (unique identifier)
  type: 'web_hook';
  address: string; // Webhook URL
  token?: string; // Optional token for webhook validation
  expiration?: number; // Unix timestamp in milliseconds (max 604800000 = 7 days)
}

export class GoogleCalendarService {
  private baseUrl = 'https://www.googleapis.com/calendar/v3';
  private accessToken: string;
  private refreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;

  constructor(accessToken: string, refreshToken?: string, clientId?: string, clientSecret?: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Refresh token, client ID, and client secret are required for token refresh');
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
      const error = await response.json();
      throw new Error(`Failed to refresh token: ${error.error || response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    return this.accessToken;
  }

  /**
   * Make authenticated request to Google Calendar API
   */
  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // If unauthorized, try refreshing token
    if (response.status === 401 && this.refreshToken) {
      await this.refreshAccessToken();
      // Retry request with new token
      return this.makeRequest(endpoint, options);
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Google Calendar API error: ${error.error?.message || response.statusText}`);
    }

    return response.json();
  }

  /**
   * List user's calendars
   */
  async getCalendars(): Promise<GoogleCalendar[]> {
    const data = await this.makeRequest('/users/me/calendarList');
    return data.items || [];
  }

  /**
   * Get calendar by ID
   */
  async getCalendar(calendarId: string): Promise<GoogleCalendar> {
    return this.makeRequest(`/calendars/${encodeURIComponent(calendarId)}`);
  }

  /**
   * Create a calendar event
   */
  async createEvent(calendarId: string, event: GoogleCalendarEvent): Promise<GoogleCalendarEvent> {
    return this.makeRequest(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  /**
   * Update a calendar event
   */
  async updateEvent(calendarId: string, eventId: string, event: Partial<GoogleCalendarEvent>): Promise<GoogleCalendarEvent> {
    return this.makeRequest(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      body: JSON.stringify(event),
    });
  }

  /**
   * Delete a calendar event
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.makeRequest(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get a calendar event by ID
   */
  async getEvent(calendarId: string, eventId: string): Promise<GoogleCalendarEvent> {
    return this.makeRequest(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  }

  /**
   * List events in a calendar
   */
  async listEvents(calendarId: string, options?: {
    timeMin?: string; // ISO 8601
    timeMax?: string; // ISO 8601
    maxResults?: number;
    singleEvents?: boolean;
    orderBy?: 'startTime' | 'updated';
  }): Promise<GoogleCalendarEvent[]> {
    const params = new URLSearchParams();
    if (options?.timeMin) params.append('timeMin', options.timeMin);
    if (options?.timeMax) params.append('timeMax', options.timeMax);
    if (options?.maxResults) params.append('maxResults', options.maxResults.toString());
    if (options?.singleEvents !== undefined) params.append('singleEvents', options.singleEvents.toString());
    if (options?.orderBy) params.append('orderBy', options.orderBy);

    const queryString = params.toString();
    const endpoint = `/calendars/${encodeURIComponent(calendarId)}/events${queryString ? `?${queryString}` : ''}`;
    
    const data = await this.makeRequest(endpoint);
    return data.items || [];
  }

  /**
   * Set up a watch channel for push notifications
   */
  async watchEvents(calendarId: string, watchRequest: WatchRequest): Promise<WatchChannel> {
    const response = await fetch(`${this.baseUrl}/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(watchRequest),
    });

    // If unauthorized, try refreshing token
    if (response.status === 401 && this.refreshToken) {
      await this.refreshAccessToken();
      // Retry request with new token
      return this.watchEvents(calendarId, watchRequest);
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Google Calendar API error: ${error.error?.message || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Stop a watch channel
   */
  async stopWatch(channelId: string, resourceId: string): Promise<void> {
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

    // If unauthorized, try refreshing token
    if (response.status === 401 && this.refreshToken) {
      await this.refreshAccessToken();
      // Retry request with new token
      return this.stopWatch(channelId, resourceId);
    }

    if (!response.ok && response.status !== 404) {
      // 404 is OK - channel may already be stopped
      const error = await response.json();
      throw new Error(`Failed to stop watch channel: ${error.error?.message || response.statusText}`);
    }
  }

  /**
   * Convert reservation to Google Calendar event
   */
  static reservationToEvent(reservation: {
    customer_name: string;
    reservation_datetime: string; // ISO 8601
    duration_minutes?: number;
    party_size: number;
    phone?: string;
    email?: string;
    notes?: string;
    special_requests?: string;
  }): GoogleCalendarEvent {
    const start = new Date(reservation.reservation_datetime);
    const duration = reservation.duration_minutes || 120;
    const end = new Date(start.getTime() + duration * 60 * 1000);

    const event: GoogleCalendarEvent = {
      summary: `Reservation: ${reservation.customer_name} (${reservation.party_size} guests)`,
      description: [
        reservation.notes && `Notes: ${reservation.notes}`,
        reservation.special_requests && `Special Requests: ${reservation.special_requests}`,
        `Party Size: ${reservation.party_size}`,
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: start.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

    if (reservation.phone || reservation.email) {
      event.attendees = [];
      if (reservation.email) {
        event.attendees.push({
          email: reservation.email,
          displayName: reservation.customer_name,
        });
      }
    }

    return event;
  }

  /**
   * Convert Google Calendar event to reservation data
   */
  static eventToReservation(event: GoogleCalendarEvent): {
    customer_name: string;
    reservation_datetime: string;
    duration_minutes: number;
    party_size: number;
    phone?: string;
    email?: string;
    notes?: string;
  } {
    // Extract customer name from summary (format: "Reservation: Name (X guests)")
    const summaryMatch = event.summary?.match(/Reservation:\s*(.+?)\s*\((\d+)\s*guests?\)/i);
    const customerName = summaryMatch ? summaryMatch[1].trim() : event.summary || 'Unknown';
    const partySize = summaryMatch ? parseInt(summaryMatch[2], 10) : 2;

    // Parse datetime
    const startDateTime = event.start?.dateTime || event.start?.date;
    if (!startDateTime) {
      throw new Error('Event missing start time');
    }

    const start = new Date(startDateTime);
    const end = event.end?.dateTime || event.end?.date;
    const duration = end ? Math.round((new Date(end).getTime() - start.getTime()) / 60000) : 120;

    // Extract notes from description
    const notes = event.description || '';

    // Extract email from attendees
    const email = event.attendees?.[0]?.email;

    return {
      customer_name: customerName,
      reservation_datetime: start.toISOString(),
      duration_minutes: duration,
      party_size: partySize,
      email,
      notes,
    };
  }
}
