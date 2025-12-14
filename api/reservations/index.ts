import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Reservation } from '../../../types';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Create a new reservation
 * POST /api/reservations
 * 
 * Body: {
 *   restaurant_id: UUID,
 *   customer_name: string,
 *   reservation_datetime: ISO 8601 string,
 *   party_size: number,
 *   phone?: string,
 *   email?: string,
 *   duration_minutes?: number (default 120),
 *   special_requests?: string,
 *   customer_notes?: string,
 *   source?: 'LOCAL' | 'GLORIA_FOODS' | etc.
 * }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Get auth token from request
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Verify user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Get user's tenant_id
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

  if (req.method === 'POST') {
    try {
      const {
        restaurant_id,
        customer_name,
        reservation_datetime,
        party_size,
        phone,
        email,
        duration_minutes = 120,
        special_requests,
        customer_notes,
        source = 'LOCAL',
      } = req.body;

      // Validate required fields
      if (!restaurant_id || !customer_name || !reservation_datetime || !party_size) {
        return res.status(400).json({
          error: 'Missing required fields: restaurant_id, customer_name, reservation_datetime, and party_size are required',
        });
      }

      // Validate reservation_datetime format
      const datetime = new Date(reservation_datetime);
      if (isNaN(datetime.getTime())) {
        return res.status(400).json({ error: 'Invalid reservation_datetime format. Use ISO 8601 format.' });
      }

      // Validate party size
      if (party_size < 1) {
        return res.status(400).json({ error: 'party_size must be at least 1' });
      }

      // Verify restaurant belongs to user's tenant
      const { data: restaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .select('id, tenant_id')
        .eq('id', restaurant_id)
        .single();

      if (restaurantError || !restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      if (restaurant.tenant_id !== tenantId && userData.role !== 'super-admin') {
        return res.status(403).json({ error: 'Access denied to this restaurant' });
      }

      // Check availability before creating (using the SQL function)
      const date = reservation_datetime.split('T')[0];
      const time = reservation_datetime.split('T')[1].substring(0, 5); // HH:MM

      const { data: availabilityData, error: availabilityError } = await supabase.rpc('check_reservation_availability', {
        p_restaurant_id: restaurant_id,
        p_date: date,
        p_time: time,
        p_party_size: party_size,
        p_duration_minutes: duration_minutes,
      });

      if (availabilityError) {
        console.error('Error checking availability:', availabilityError);
        // Continue anyway - let the database constraints handle it
      } else {
        const availability = Array.isArray(availabilityData) && availabilityData.length > 0 ? availabilityData[0] : null;
        if (availability && !availability.is_available) {
          return res.status(409).json({
            error: 'Time slot not available',
            availability: {
              available_capacity: availability.available_capacity,
              current_reserved_guests: availability.current_reserved_guests,
              total_capacity: availability.total_capacity,
              conflicting_reservations: availability.conflicting_reservations,
            },
          });
        }
      }

      // Create reservation
      const { data: reservation, error: insertError } = await supabase
        .from('reservations')
        .insert({
          restaurant_id,
          tenant_id: tenantId,
          customer_name,
          reservation_datetime: reservation_datetime,
          duration_minutes,
          party_size,
          phone: phone || null,
          email: email || null,
          special_requests: special_requests || null,
          customer_notes: customer_notes || null,
          source,
          status: 'PENDING',
          // Legacy fields for backward compatibility
          date: date,
          time: time,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Error creating reservation:', insertError);
        return res.status(500).json({
          error: 'Failed to create reservation',
          details: insertError.message,
        });
      }

      // Sync to Google Calendar if enabled
      try {
        const { data: restaurantProfile } = await supabase
          .from('restaurants')
          .select('profile_data')
          .eq('id', restaurant_id)
          .single();

        const profileData = (restaurantProfile?.profile_data as any) || {};
        if (profileData.integrations?.googleCalendar) {
          const { syncReservationToGoogleCalendar } = await import('../../../lib/calendarSync.js');
          await syncReservationToGoogleCalendar(reservation.id, restaurant_id, tenantId);
        }
      } catch (syncError) {
        console.error('Error syncing to Google Calendar:', syncError);
        // Don't fail the request if sync fails - it will be queued for retry
      }

      return res.status(201).json(reservation as Reservation);

    } catch (error: any) {
      console.error('Error in reservation creation:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: error.message,
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
