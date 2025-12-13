import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Get available time slots for a given date
 * Returns all time slots with availability information
 * 
 * GET /api/reservations/available-slots?restaurant_id=xxx&date=2025-01-15&party_size=4
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

  if (req.method === 'GET') {
    try {
      const { restaurant_id, date, party_size } = req.query;

      // Validate required parameters
      if (!restaurant_id || !date) {
        return res.status(400).json({ 
          error: 'Missing required parameters: restaurant_id and date are required' 
        });
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date as string)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      // Validate party size (optional, defaults to 1)
      const partySize = party_size ? parseInt(party_size as string) : 1;
      if (isNaN(partySize) || partySize < 1) {
        return res.status(400).json({ error: 'party_size must be a positive integer' });
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

      // Get all time slots for the date
      const { data: timeSlots, error: slotsError } = await supabase
        .from('time_slot_capacity')
        .select('*')
        .eq('restaurant_id', restaurant_id)
        .eq('slot_date', date)
        .gte('available_capacity', partySize) // Only slots with enough capacity
        .order('slot_time', { ascending: true });

      if (slotsError) {
        console.error('Error fetching time slots:', slotsError);
        return res.status(500).json({ 
          error: 'Failed to fetch available slots',
          details: slotsError.message 
        });
      }

      // Format response
      const availableSlots = (timeSlots || []).map(slot => ({
        time: slot.slot_time,
        available_capacity: slot.available_capacity,
        total_capacity: slot.total_capacity,
        reserved_guests: slot.reserved_guests,
        is_available: slot.available_capacity >= partySize,
      }));

      return res.status(200).json({
        date,
        party_size: partySize,
        available_slots: availableSlots,
        total_slots: availableSlots.length,
      });

    } catch (error: any) {
      console.error('Error fetching available slots:', error);
      return res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
