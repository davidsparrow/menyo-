import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createEmailService } from '../../services/emailService';
import type { RestaurantProfile } from '../../types';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Email-Only Reservation Endpoint (Path A)
 * Handles reservations for restaurants using EMAIL_ONLY reservation mode
 * - No calendar integration
 * - Reservations sent directly to owner's email
 * - Manual confirmation required
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No auth token provided' });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    // 2. Get restaurant profile
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (restaurantError || !restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const profileData = restaurant.profile_data as RestaurantProfile;

    // 3. Verify Email-Only reservation mode is enabled (Path A only)
    if (profileData.orderHandlingMode === 'EMAIL_ONLY' &&
        profileData.reservationHandlingMode !== 'EMAIL_ONLY') {
      return res.status(400).json({
        error: 'Email-only reservations not enabled. Current mode: ' + profileData.reservationHandlingMode
      });
    }

    if (profileData.orderHandlingMode === 'EMAIL_ONLY' &&
        !profileData.emailReservationSettings?.deliveryEmail) {
      return res.status(400).json({
        error: 'Email reservation settings not configured. Please set delivery email in Settings.'
      });
    }

    // 4. Validate reservation data
    const {
      customerName,
      phone,
      email,
      date,
      time,
      partySize,
      specialRequests,
    } = req.body;

    if (!customerName || !phone || !date || !time || !partySize) {
      return res.status(400).json({
        error: 'Missing required fields: customerName, phone, date, time, partySize'
      });
    }

    if (partySize < 1 || partySize > 100) {
      return res.status(400).json({
        error: 'Invalid party size. Must be between 1 and 100.'
      });
    }

    // 5. Generate reservation ID
    const reservationId = `EMAIL-RES-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    // 6. Store reservation in database
    const { error: reservationInsertError } = await supabase
      .from('reservations')
      .insert({
        id: reservationId,
        restaurant_id: restaurant.id,
        tenant_id: restaurant.tenant_id,
        customer_name: customerName,
        phone,
        email,
        date, // YYYY-MM-DD format
        time, // HH:MM format
        party_size: partySize,
        status: 'PENDING', // Email reservations need manual confirmation
        customer_notes: specialRequests,
        internal_notes: 'Email-only reservation - requires manual confirmation',
        source: 'LOCAL',
        created_at: timestamp,
        updated_at: timestamp,
      });

    if (reservationInsertError) {
      console.error('Error inserting reservation:', reservationInsertError);
      return res.status(500).json({ error: 'Failed to save reservation' });
    }

    // 7. Send email to restaurant owner
    const deliveryEmail = profileData.emailReservationSettings?.deliveryEmail ||
                          profileData.emailOrderSettings?.deliveryEmail ||
                          profileData.ownerEmail;

    if (!deliveryEmail) {
      return res.status(400).json({
        error: 'No delivery email configured. Please set email in Settings.'
      });
    }

    const emailService = createEmailService();
    const emailResult = await emailService.sendEmailOnlyReservation(
      deliveryEmail,
      {
        reservationId,
        customerName,
        phone,
        email,
        date,
        time,
        partySize,
        specialRequests,
        timestamp,
      }
    );

    if (!emailResult.success) {
      console.error('Email send failed:', emailResult.error);
      // Reservation is saved, but email failed - return partial success
      return res.status(207).json({
        reservation: {
          reservationId,
          status: 'PENDING',
          timestamp,
        },
        warning: 'Reservation saved but email notification failed. Please check your email settings.',
        emailError: emailResult.error,
      });
    }

    // 8. Return success response
    return res.status(200).json({
      success: true,
      reservation: {
        reservationId,
        status: 'PENDING',
        timestamp,
        customerName,
        phone,
        email,
        date,
        time,
        partySize,
        specialRequests,
      },
      message: 'Reservation request received! We\'ll contact you shortly to confirm availability.',
    });

  } catch (error: any) {
    console.error('Error processing email reservation:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
