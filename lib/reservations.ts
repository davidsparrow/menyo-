// Helper functions for reservation management
import { supabase } from './supabase';
import { AvailabilityCheckResult, Reservation } from '../types';

/**
 * Check if a time slot is available for a reservation
 */
export async function checkReservationAvailability(
  restaurantId: string,
  date: string, // YYYY-MM-DD
  time: string, // HH:MM or HH:MM:SS
  partySize: number,
  durationMinutes: number = 120
): Promise<AvailabilityCheckResult | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(
      `/api/reservations/availability?restaurant_id=${restaurantId}&date=${date}&time=${time}&party_size=${partySize}&duration_minutes=${durationMinutes}`,
      {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to check availability');
    }

    return await response.json();
  } catch (error) {
    console.error('Error checking availability:', error);
    return null;
  }
}

/**
 * Get all available time slots for a date
 */
export async function getAvailableSlots(
  restaurantId: string,
  date: string, // YYYY-MM-DD
  partySize: number = 1
): Promise<Array<{ time: string; available_capacity: number; is_available: boolean }> | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(
      `/api/reservations/available-slots?restaurant_id=${restaurantId}&date=${date}&party_size=${partySize}`,
      {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get available slots');
    }

    const data = await response.json();
    return data.available_slots || [];
  } catch (error) {
    console.error('Error getting available slots:', error);
    return null;
  }
}

/**
 * Create a reservation with availability checking
 */
export async function createReservation(
  restaurantId: string,
  reservationData: {
    customer_name: string;
    reservation_datetime: string; // ISO 8601
    party_size: number;
    phone?: string;
    email?: string;
    duration_minutes?: number;
    special_requests?: string;
    customer_notes?: string;
    source?: 'LOCAL' | 'GLORIA_FOODS' | 'GOOGLE_CALENDAR' | 'PHONE' | 'WALK_IN';
  }
): Promise<Reservation | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('Not authenticated');
    }

    // First check availability
    const date = reservationData.reservation_datetime.split('T')[0];
    const time = reservationData.reservation_datetime.split('T')[1].substring(0, 5); // HH:MM
    const availability = await checkReservationAvailability(
      restaurantId,
      date,
      time,
      reservationData.party_size,
      reservationData.duration_minutes || 120
    );

    if (!availability || !availability.is_available) {
      throw new Error(
        `Time slot not available. Available capacity: ${availability?.available_capacity || 0}, Required: ${reservationData.party_size}`
      );
    }

    // Create reservation via API
    const response = await fetch('/api/reservations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        restaurant_id: restaurantId,
        ...reservationData,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create reservation');
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating reservation:', error);
    throw error;
  }
}
