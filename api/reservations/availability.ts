import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { AvailabilityCheckResult } from '../../../types.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Check reservation availability for a given date, time, and party size
 * Uses the check_reservation_availability() SQL function for fast queries
 * 
 * GET /api/reservations/availability?restaurant_id=xxx&date=2025-01-15&time=18:00&party_size=4&duration_minutes=120
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
      const { restaurant_id, date, time, party_size, duration_minutes } = req.query;

      // Validate required parameters
      if (!restaurant_id || !date || !time || !party_size) {
        return res.status(400).json({ 
          error: 'Missing required parameters: restaurant_id, date, time, and party_size are required' 
        });
      }

      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date as string)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      // Validate time format (HH:MM or HH:MM:SS)
      const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;
      if (!timeRegex.test(time as string)) {
        return res.status(400).json({ error: 'Invalid time format. Use HH:MM or HH:MM:SS' });
      }

      // Validate party size
      const partySize = parseInt(party_size as string);
      if (isNaN(partySize) || partySize < 1) {
        return res.status(400).json({ error: 'party_size must be a positive integer' });
      }

      // Validate duration (optional, default 120 minutes)
      const duration = duration_minutes ? parseInt(duration_minutes as string) : 120;
      if (isNaN(duration) || duration < 30) {
        return res.status(400).json({ error: 'duration_minutes must be at least 30' });
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

      // Call the SQL function to check availability
      const { data, error } = await supabase.rpc('check_reservation_availability', {
        p_restaurant_id: restaurant_id,
        p_date: date,
        p_time: time,
        p_party_size: partySize,
        p_duration_minutes: duration,
      });

      if (error) {
        console.error('Error checking availability:', error);
        return res.status(500).json({ 
          error: 'Failed to check availability',
          details: error.message 
        });
      }

      // The function returns a table, so data is an array
      const result = Array.isArray(data) && data.length > 0 ? data[0] : null;

      if (!result) {
        // If no result, create a default response (slot might not exist yet)
        return res.status(200).json({
          is_available: false,
          available_capacity: 0,
          current_reserved_guests: 0,
          total_capacity: 50, // Default
          conflicting_reservations: 0,
          message: 'Time slot not found. Capacity may need to be initialized.',
        } as AvailabilityCheckResult);
      }

      return res.status(200).json(result as AvailabilityCheckResult);

    } catch (error: any) {
      console.error('Error in availability check:', error);
      return res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
