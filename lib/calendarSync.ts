// Calendar Sync Logic
// Handles two-way sync between local reservations and Google Calendar events
// Implements conflict resolution using last-write-wins strategy

import { createClient } from '@supabase/supabase-js';
import { GoogleCalendarService, GoogleCalendarEvent } from '../services/googleCalendarService';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
const googleClientId = process.env.GOOGLE_CLIENT_ID!;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!;

function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey.padEnd(32).slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function getGoogleCalendarService(tenantId: string): Promise<GoogleCalendarService | null> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('encrypted_key')
    .eq('tenant_id', tenantId)
    .eq('key_type', 'google_calendar')
    .single();

  if (error || !data) {
    return null;
  }

  try {
    const refreshToken = decrypt(data.encrypted_key);
    const service = new GoogleCalendarService('', refreshToken, googleClientId, googleClientSecret);
    await service.refreshAccessToken();
    return service;
  } catch (err) {
    console.error('Error getting Google Calendar service:', err);
    return null;
  }
}

/**
 * Sync local reservation to Google Calendar
 * Creates or updates calendar event when reservation changes
 */
export async function syncReservationToGoogleCalendar(
  reservationId: string,
  restaurantId: string,
  tenantId: string
): Promise<string | null> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get reservation
  const { data: reservation, error: resError } = await supabase
    .from('reservations')
    .select('*')
    .eq('id', reservationId)
    .single();

  if (resError || !reservation) {
    throw new Error('Reservation not found');
  }

  // Get restaurant profile to find calendar ID
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('profile_data')
    .eq('id', restaurantId)
    .single();

  if (!restaurant) {
    throw new Error('Restaurant not found');
  }

  const profileData = (restaurant.profile_data as any) || {};
  const calendarId = profileData.googleCalendarId || 'primary';

  // Get Google Calendar service
  const service = await getGoogleCalendarService(tenantId);
  if (!service) {
    throw new Error('Google Calendar not connected');
  }

  try {
    // Convert reservation to event
    const event = GoogleCalendarService.reservationToEvent({
      customer_name: reservation.customer_name,
      reservation_datetime: reservation.reservation_datetime || `${reservation.date}T${reservation.time}`,
      duration_minutes: reservation.duration_minutes || 120,
      party_size: reservation.party_size,
      phone: reservation.phone || undefined,
      email: reservation.email || undefined,
      notes: reservation.notes || reservation.customer_notes || undefined,
      special_requests: reservation.special_requests || undefined,
    });

    // Add reservation ID to extended properties for tracking
    event.extendedProperties = {
      private: {
        menyo_reservation_id: reservation.id,
      },
    };

    let eventId: string;

    if (reservation.google_calendar_event_id) {
      // Update existing event
      await service.updateEvent(calendarId, reservation.google_calendar_event_id, event);
      eventId = reservation.google_calendar_event_id;
    } else {
      // Create new event
      const createdEvent = await service.createEvent(calendarId, event);
      eventId = createdEvent.id!;

      // Update reservation with event ID
      await supabase
        .from('reservations')
        .update({
          google_calendar_event_id: eventId,
          last_synced_at: new Date().toISOString(),
          last_modified_source: 'LOCAL',
        })
        .eq('id', reservationId);
    }

    return eventId;
  } catch (error: any) {
    console.error('Error syncing reservation to Google Calendar:', error);
    // Queue for retry
    await queueSyncOperation(restaurantId, tenantId, 'create_event', {
      reservation_id: reservationId,
      calendar_id: calendarId,
    });
    throw error;
  }
}

/**
 * Sync Google Calendar event to local reservation
 * Creates or updates reservation when Google event changes
 * Implements conflict resolution using last-write-wins
 */
export async function syncGoogleEventToReservation(
  event: GoogleCalendarEvent,
  restaurantId: string,
  tenantId: string,
  calendarId: string
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (!event.id) {
    throw new Error('Event missing ID');
  }

  // Extract reservation ID from extended properties
  const reservationId = event.extendedProperties?.private?.menyo_reservation_id;

  // Convert event to reservation data
  const reservationData = GoogleCalendarService.eventToReservation(event);

  // Check if reservation already exists
  let existingReservation: any = null;
  
  if (reservationId) {
    // Find by reservation ID
    const { data } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', reservationId)
      .single();
    existingReservation = data;
  } else {
    // Find by Google Calendar event ID
    const { data } = await supabase
      .from('reservations')
      .select('*')
      .eq('google_calendar_event_id', event.id)
      .single();
    existingReservation = data;
  }

  // Conflict resolution: compare timestamps
  if (existingReservation) {
    const eventUpdated = event.updated ? new Date(event.updated).getTime() : 0;
    const localUpdated = existingReservation.updated_at ? new Date(existingReservation.updated_at).getTime() : 0;

    // If local is newer, update Google Calendar instead
    if (localUpdated > eventUpdated && existingReservation.last_modified_source === 'LOCAL') {
      // Local is newer - update Google Calendar
      try {
        const service = await getGoogleCalendarService(tenantId);
        if (service) {
          const updateEvent = GoogleCalendarService.reservationToEvent({
            customer_name: existingReservation.customer_name,
            reservation_datetime: existingReservation.reservation_datetime || `${existingReservation.date}T${existingReservation.time}`,
            duration_minutes: existingReservation.duration_minutes || 120,
            party_size: existingReservation.party_size,
            phone: existingReservation.phone || undefined,
            email: existingReservation.email || undefined,
            notes: existingReservation.notes || existingReservation.customer_notes || undefined,
            special_requests: existingReservation.special_requests || undefined,
          });
          await service.updateEvent(calendarId, event.id, updateEvent);
        }
      } catch (error) {
        console.error('Error updating Google Calendar from local:', error);
      }
      return; // Skip local update
    }

    // Google is newer or equal - update local reservation
    const { error: updateError } = await supabase
      .from('reservations')
      .update({
        customer_name: reservationData.customer_name,
        reservation_datetime: reservationData.reservation_datetime,
        duration_minutes: reservationData.duration_minutes,
        party_size: reservationData.party_size,
        email: reservationData.email || existingReservation.email,
        notes: reservationData.notes || existingReservation.notes,
        google_calendar_event_id: event.id,
        last_synced_at: new Date().toISOString(),
        last_modified_source: 'GOOGLE_CALENDAR',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingReservation.id);

    if (updateError) {
      throw new Error(`Failed to update reservation: ${updateError.message}`);
    }
  } else {
    // Create new reservation
    const { error: insertError } = await supabase
      .from('reservations')
      .insert({
        restaurant_id: restaurantId,
        tenant_id: tenantId,
        customer_name: reservationData.customer_name,
        reservation_datetime: reservationData.reservation_datetime,
        duration_minutes: reservationData.duration_minutes,
        party_size: reservationData.party_size,
        email: reservationData.email,
        notes: reservationData.notes,
        status: 'CONFIRMED',
        source: 'GOOGLE_CALENDAR',
        google_calendar_event_id: event.id,
        last_synced_at: new Date().toISOString(),
        last_modified_source: 'GOOGLE_CALENDAR',
        // Legacy fields
        date: reservationData.reservation_datetime.split('T')[0],
        time: reservationData.reservation_datetime.split('T')[1].substring(0, 5),
      });

    if (insertError) {
      throw new Error(`Failed to create reservation: ${insertError.message}`);
    }
  }
}

/**
 * Delete Google Calendar event when reservation is cancelled
 */
export async function deleteGoogleCalendarEvent(
  reservationId: string,
  restaurantId: string,
  tenantId: string
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get reservation
  const { data: reservation } = await supabase
    .from('reservations')
    .select('google_calendar_event_id')
    .eq('id', reservationId)
    .single();

  if (!reservation?.google_calendar_event_id) {
    return; // No event to delete
  }

  // Get restaurant profile
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('profile_data')
    .eq('id', restaurantId)
    .single();

  if (!restaurant) {
    return;
  }

  const profileData = (restaurant.profile_data as any) || {};
  const calendarId = profileData.googleCalendarId || 'primary';

  // Get Google Calendar service
  const service = await getGoogleCalendarService(tenantId);
  if (!service) {
    return;
  }

  try {
    await service.deleteEvent(calendarId, reservation.google_calendar_event_id);
  } catch (error: any) {
    console.error('Error deleting Google Calendar event:', error);
    // Queue for retry
    await queueSyncOperation(restaurantId, tenantId, 'delete_event', {
      reservation_id: reservationId,
      event_id: reservation.google_calendar_event_id,
      calendar_id: calendarId,
    });
  }
}

/**
 * Queue a sync operation for retry
 */
async function queueSyncOperation(
  restaurantId: string,
  tenantId: string,
  operationType: string,
  payload: any
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Calculate next retry with exponential backoff (1 minute initially)
  const nextRetryAt = new Date(Date.now() + 60 * 1000);

  await supabase
    .from('sync_queue')
    .insert({
      restaurant_id: restaurantId,
      tenant_id: tenantId,
      operation_type: operationType,
      payload,
      next_retry_at: nextRetryAt.toISOString(),
      status: 'PENDING',
    });
}
