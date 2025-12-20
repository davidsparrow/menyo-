import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { GoogleCalendarService } from '../../../services/googleCalendarService';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';

function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey.padEnd(32).slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function getGoogleCalendarTokens(tenantId: string): Promise<{ accessToken: string; refreshToken: string } | null> {
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
    const decrypted = decrypt(data.encrypted_key);
    const tokens = JSON.parse(decrypted);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
  } catch (err) {
    console.error('Error decrypting Google Calendar tokens:', err);
    return null;
  }
}

async function getSelectedCalendarId(restaurantId: string): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('profile_data')
    .eq('id', restaurantId)
    .single();

  const profileData = (restaurant?.profile_data as any) || {};
  return profileData.googleCalendarId || 'primary';
}

/**
 * Create, update, or delete Google Calendar events
 * POST /api/google-calendar/events - Create event for reservation
 * PUT /api/google-calendar/events - Update event
 * DELETE /api/google-calendar/events - Delete event
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single();

  if (!userData) {
    return res.status(403).json({ error: 'User not found' });
  }

  const tenantId = userData.tenant_id;
  if (!tenantId && userData.role !== 'super-admin') {
    return res.status(403).json({ error: 'No tenant associated' });
  }

  // Get tokens
  const tokens = await getGoogleCalendarTokens(tenantId!);
  if (!tokens) {
    return res.status(404).json({ error: 'Google Calendar not connected' });
  }

  const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);

  if (req.method === 'POST') {
    try {
      const { reservation_id, restaurant_id } = req.body;

      if (!reservation_id || !restaurant_id) {
        return res.status(400).json({ error: 'reservation_id and restaurant_id are required' });
      }

      // Get reservation
      const { data: reservation } = await supabase
        .from('reservations')
        .select('*')
        .eq('id', reservation_id)
        .single();

      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      // Get calendar ID
      const calendarId = await getSelectedCalendarId(restaurant_id);

      // Import sync function
      const { syncReservationToGoogleCalendar } = await import('../../../lib/calendarSync');
      const eventId = await syncReservationToGoogleCalendar(reservation_id, restaurant_id, tenantId!);

      return res.status(200).json({ 
        success: true,
        event_id: eventId,
        calendar_id: calendarId,
      });
    } catch (error: any) {
      console.error('Error creating event:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to create event' 
      });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { event_id, calendar_id, restaurant_id, updates } = req.body;

      if (!event_id || !calendar_id) {
        return res.status(400).json({ error: 'event_id and calendar_id are required' });
      }

      const updatedEvent = await calendarService.updateEvent(calendar_id, event_id, updates || {});

      return res.status(200).json({ 
        success: true,
        event: updatedEvent,
      });
    } catch (error: any) {
      console.error('Error updating event:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to update event' 
      });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { event_id, calendar_id } = req.body;

      if (!event_id || !calendar_id) {
        return res.status(400).json({ error: 'event_id and calendar_id are required' });
      }

      await calendarService.deleteEvent(calendar_id, event_id);

      return res.status(200).json({ 
        success: true,
        message: 'Event deleted successfully' 
      });
    } catch (error: any) {
      console.error('Error deleting event:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to delete event' 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
