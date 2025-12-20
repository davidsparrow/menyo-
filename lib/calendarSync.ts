// Calendar Sync Library
// Handles two-way sync between reservations and Google Calendar

import { createClient } from '@supabase/supabase-js';
import { GoogleCalendarService, reservationToEvent, eventToReservation } from '../services/googleCalendarService';
import { Reservation } from '../types';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey.padEnd(32).slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Get Google Calendar OAuth tokens for a tenant
 */
async function getGoogleCalendarTokens(tenantId: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('encrypted_key')
      .eq('tenant_id', tenantId)
      .eq('key_type', 'google_calendar')
      .single();

    if (error || !data) {
      return null;
    }

    // Decrypt and parse JSON (contains both access and refresh tokens)
    const decrypted = decrypt(data.encrypted_key);
    const tokens = JSON.parse(decrypted);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
  } catch (err) {
    console.error('Error getting Google Calendar tokens:', err);
    return null;
  }
}

/**
 * Get selected calendar ID for a restaurant
 */
async function getSelectedCalendarId(restaurantId: string): Promise<string | null> {
  try {
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('profile_data')
      .eq('id', restaurantId)
      .single();

    const profileData = (restaurant?.profile_data as any) || {};
    return profileData.googleCalendarId || 'primary'; // Default to primary calendar
  } catch (err) {
    console.error('Error getting selected calendar:', err);
    return 'primary';
  }
}

/**
 * Queue sync operation for retry
 */
async function queueSyncOperation(
  restaurantId: string,
  tenantId: string,
  operationType: 'create_event' | 'update_event' | 'delete_event' | 'sync_from_google',
  payload: any,
  errorMessage?: string
): Promise<void> {
  try {
    // Calculate next retry time with exponential backoff
    const retryCount = 0; // Will be updated on retry
    const backoffMinutes = Math.min(Math.pow(2, retryCount), 16); // 1, 2, 4, 8, 16 minutes
    const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

    await supabase.from('sync_queue').insert({
      restaurant_id: restaurantId,
      tenant_id: tenantId,
      operation_type: operationType,
      payload,
      retry_count: 0,
      max_retries: 5,
      next_retry_at: nextRetryAt.toISOString(),
      error_message: errorMessage,
      status: 'PENDING',
    });
  } catch (err) {
    console.error('Error queueing sync operation:', err);
  }
}

/**
 * Sync reservation to Google Calendar (create or update event)
 */
export async function syncReservationToGoogleCalendar(
  reservationId: string,
  restaurantId: string,
  tenantId: string
): Promise<string | null> {
  try {
    // Get reservation
    const { data: reservation, error: resError } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', reservationId)
      .single();

    if (resError || !reservation) {
      throw new Error('Reservation not found');
    }

    // Get Google Calendar tokens
    const tokens = await getGoogleCalendarTokens(tenantId);
    if (!tokens) {
      throw new Error('Google Calendar not connected');
    }

    // Get selected calendar
    const calendarId = await getSelectedCalendarId(restaurantId) || 'primary';

    // Create service
    const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);

    // Convert reservation to event
    const event = reservationToEvent({
      customer_name: reservation.customer_name,
      reservation_datetime: reservation.reservation_datetime || `${reservation.date}T${reservation.time}`,
      duration_minutes: reservation.duration_minutes || 120,
      party_size: reservation.party_size,
      phone: reservation.phone || undefined,
      email: reservation.email || undefined,
      customer_notes: reservation.customer_notes || undefined,
      special_requests: reservation.special_requests || undefined,
    });

    // Add reservation ID to extended properties for tracking
    event.extendedProperties = {
      private: {
        menyo_reservation_id: reservationId,
      },
    };

    let googleEventId: string;

    if (reservation.google_calendar_event_id) {
      // Update existing event
      const updatedEvent = await calendarService.updateEvent(
        calendarId,
        reservation.google_calendar_event_id,
        event
      );
      googleEventId = updatedEvent.id || reservation.google_calendar_event_id;
    } else {
      // Create new event
      const createdEvent = await calendarService.createEvent(calendarId, event);
      googleEventId = createdEvent.id || '';
    }

    // Update reservation with Google event ID
    await supabase
      .from('reservations')
      .update({
        google_calendar_event_id: googleEventId,
        last_synced_at: new Date().toISOString(),
        last_modified_source: 'LOCAL',
      })
      .eq('id', reservationId);

    return googleEventId;
  } catch (error: any) {
    console.error('Error syncing reservation to Google Calendar:', error);
    
    // Get reservation to check if it has event ID
    const { data: reservation } = await supabase
      .from('reservations')
      .select('google_calendar_event_id')
      .eq('id', reservationId)
      .single();

    // Queue for retry
    await queueSyncOperation(
      restaurantId,
      tenantId,
      reservation?.google_calendar_event_id ? 'update_event' : 'create_event',
      { reservation_id: reservationId },
      error.message
    );

    throw error;
  }
}

/**
 * Sync Google Calendar event to reservation (create or update)
 */
export async function syncGoogleEventToReservation(
  calendarId: string,
  eventId: string,
  restaurantId: string,
  tenantId: string,
  changeType: 'created' | 'updated' | 'deleted'
): Promise<string | null> {
  try {
    // Get Google Calendar tokens
    const tokens = await getGoogleCalendarTokens(tenantId);
    if (!tokens) {
      throw new Error('Google Calendar not connected');
    }

    const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);

    if (changeType === 'deleted') {
      // Find reservation by Google event ID and mark as cancelled
      const { data: reservation } = await supabase
        .from('reservations')
        .select('id')
        .eq('google_calendar_event_id', eventId)
        .eq('restaurant_id', restaurantId)
        .single();

      if (reservation) {
        await supabase
          .from('reservations')
          .update({
            status: 'CANCELLED',
            cancelled_at: new Date().toISOString(),
            cancellation_reason: 'Deleted from Google Calendar',
            last_synced_at: new Date().toISOString(),
            last_modified_source: 'GOOGLE_CALENDAR',
          })
          .eq('id', reservation.id);
      }
      return reservation?.id || null;
    }

    // Fetch event from Google
    const event = await calendarService.getEvent(calendarId, eventId);
    
    // Convert event to reservation data
    const reservationData = eventToReservation(event);

    // Check if reservation already exists (by Google event ID)
    const { data: existingReservation } = await supabase
      .from('reservations')
      .select('id, updated_at')
      .eq('google_calendar_event_id', eventId)
      .eq('restaurant_id', restaurantId)
      .single();

    // Conflict resolution: Compare timestamps
    const eventUpdated = event.updated ? new Date(event.updated).getTime() : 0;
    const localUpdated = existingReservation?.updated_at ? new Date(existingReservation.updated_at).getTime() : 0;

    // If local is newer, skip update (don't overwrite local changes)
    if (existingReservation && localUpdated > eventUpdated) {
      console.log('Skipping sync - local reservation is newer');
      return existingReservation.id;
    }

    if (existingReservation) {
      // Update existing reservation
      const { data: updated } = await supabase
        .from('reservations')
        .update({
          customer_name: reservationData.customer_name,
          reservation_datetime: reservationData.reservation_datetime,
          duration_minutes: reservationData.duration_minutes,
          party_size: reservationData.party_size,
          email: reservationData.email || null,
          customer_notes: reservationData.customer_notes || null,
          last_synced_at: new Date().toISOString(),
          last_modified_source: 'GOOGLE_CALENDAR',
          // Legacy fields
          date: reservationData.reservation_datetime.split('T')[0],
          time: reservationData.reservation_datetime.split('T')[1].substring(0, 5),
        })
        .eq('id', existingReservation.id)
        .select()
        .single();

      return updated?.id || existingReservation.id;
    } else {
      // Create new reservation
      const { data: newReservation } = await supabase
        .from('reservations')
        .insert({
          restaurant_id: restaurantId,
          tenant_id: tenantId,
          customer_name: reservationData.customer_name,
          reservation_datetime: reservationData.reservation_datetime,
          duration_minutes: reservationData.duration_minutes,
          party_size: reservationData.party_size,
          email: reservationData.email || null,
          customer_notes: reservationData.customer_notes || null,
          google_calendar_event_id: eventId,
          source: 'GOOGLE_CALENDAR',
          status: 'CONFIRMED',
          last_synced_at: new Date().toISOString(),
          last_modified_source: 'GOOGLE_CALENDAR',
          // Legacy fields
          date: reservationData.reservation_datetime.split('T')[0],
          time: reservationData.reservation_datetime.split('T')[1].substring(0, 5),
        })
        .select()
        .single();

      return newReservation?.id || null;
    }
  } catch (error: any) {
    console.error('Error syncing Google event to reservation:', error);
    
    // Queue for retry
    await queueSyncOperation(
      restaurantId,
      tenantId,
      'sync_from_google',
      { calendar_id: calendarId, event_id: eventId, change_type: changeType },
      error.message
    );

    throw error;
  }
}

/**
 * Handle incoming Google Calendar webhook notification
 */
export async function handleCalendarWebhook(
  resourceId: string,
  channelToken: string,
  restaurantId: string,
  tenantId: string
): Promise<void> {
  try {
    // Validate webhook token
    const { data: watch } = await supabase
      .from('google_calendar_watches')
      .select('*')
      .eq('resource_id', resourceId)
      .eq('restaurant_id', restaurantId)
      .single();

    if (!watch || watch.channel_token !== channelToken) {
      throw new Error('Invalid webhook token');
    }

    // Get tokens
    const tokens = await getGoogleCalendarTokens(tenantId);
    if (!tokens) {
      throw new Error('Google Calendar not connected');
    }

    const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);

    // Fetch events that changed (use timeMin to get recent changes)
    const timeMin = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // Last 5 minutes
    const events = await calendarService.listEvents(watch.calendar_id, {
      timeMin,
      maxResults: 50,
      orderBy: 'updated',
    });

    // Process each event
    for (const event of events) {
      if (!event.id) continue;

      // Determine change type by checking if reservation exists
      const { data: existing } = await supabase
        .from('reservations')
        .select('id')
        .eq('google_calendar_event_id', event.id)
        .single();

      const changeType = existing ? 'updated' : 'created';
      
      await syncGoogleEventToReservation(
        watch.calendar_id,
        event.id,
        restaurantId,
        tenantId,
        changeType
      );
    }
  } catch (error: any) {
    console.error('Error handling calendar webhook:', error);
    throw error;
  }
}
