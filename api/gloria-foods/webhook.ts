import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Webhook endpoint to receive order status updates from Gloria Foods
 * This endpoint should be configured in Gloria Foods dashboard as:
 * - Endpoint URL: https://your-domain.com/api/gloria-foods/webhook
 * - Master Key: (stored in restaurant profile or env var)
 * 
 * Gloria Foods will POST to this endpoint when order status changes
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Webhooks from Gloria Foods should include authentication
  // Check for master key in headers or query params
  const masterKey = req.headers['x-gloria-master-key'] || req.query.master_key;
  const expectedMasterKey = process.env.GLORIA_FOODS_MASTER_KEY;

  // Verify master key if configured
  if (expectedMasterKey && masterKey !== expectedMasterKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid master key' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhookData = req.body;
    
    // Expected webhook payload structure (adjust based on actual Gloria Foods webhook format)
    const {
      order_id,
      restaurant_id,
      status,
      customer_name,
      customer_phone,
      items,
      total,
      estimated_ready_time,
      actual_ready_time,
      event_type, // e.g., 'order_placed', 'order_confirmed', 'order_ready', 'order_completed'
    } = webhookData;

    if (!order_id) {
      return res.status(400).json({ error: 'Missing order_id in webhook payload' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find restaurant by restaurant_id (Gloria Foods restaurant ID)
    // We may need to store this mapping in the restaurant profile
    const { data: restaurants } = await supabase
      .from('restaurants')
      .select('id, tenant_id, profile_data')
      .limit(100); // We'll need to match by restaurant_id stored in profile_data

    // Find matching restaurant (this is a simplified approach)
    // In production, you'd want to store Gloria Foods restaurant_id in profile_data
    let matchingRestaurant = null;
    for (const restaurant of restaurants || []) {
      const profile = restaurant.profile_data as any;
      if (profile?.gloriaFoodsRestaurantId === restaurant_id) {
        matchingRestaurant = restaurant;
        break;
      }
    }

    if (!matchingRestaurant) {
      console.warn(`No matching restaurant found for Gloria Foods restaurant_id: ${restaurant_id}`);
      // Still return 200 to acknowledge webhook receipt
      return res.status(200).json({ received: true, message: 'Webhook received but restaurant not found' });
    }

    // Update or create order in database
    // First, check if order exists
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id')
      .eq('gloria_foods_order_id', order_id)
      .single();

    const orderData = {
      restaurant_id: matchingRestaurant.id,
      tenant_id: matchingRestaurant.tenant_id,
      gloria_foods_order_id: order_id,
      customer_name: customer_name,
      phone: customer_phone,
      items: items || [],
      total: total || 0,
      status: mapGloriaFoodsStatus(status),
      estimated_ready_time: estimated_ready_time,
      actual_ready_time: actual_ready_time,
      updated_at: new Date().toISOString(),
    };

    if (existingOrder) {
      // Update existing order
      const { error: updateError } = await supabase
        .from('orders')
        .update(orderData)
        .eq('id', existingOrder.id);

      if (updateError) {
        console.error('Error updating order:', updateError);
        return res.status(500).json({ error: 'Failed to update order' });
      }
    } else {
      // Create new order
      const { error: insertError } = await supabase
        .from('orders')
        .insert({
          ...orderData,
          created_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('Error creating order:', insertError);
        return res.status(500).json({ error: 'Failed to create order' });
      }
    }

    // Handle specific event types (e.g., trigger AI voice call when order is ready)
    if (event_type === 'order_ready' && customer_phone) {
      // TODO: Trigger AI voice call to customer
      // This would integrate with Twilio and Gemini Live API
      console.log(`Order ${order_id} is ready! Should call customer at ${customer_phone}`);
    }

    return res.status(200).json({ 
      received: true,
      message: 'Webhook processed successfully',
      order_id,
    });
  } catch (error: any) {
    console.error('Error processing Gloria Foods webhook:', error);
    return res.status(500).json({ 
      error: 'Failed to process webhook',
      message: error.message,
    });
  }
}

/**
 * Map Gloria Foods status to our Order status enum
 */
function mapGloriaFoodsStatus(status: string): 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED' {
  const statusMap: Record<string, 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED'> = {
    'pending': 'PENDING',
    'confirmed': 'CONFIRMED',
    'preparing': 'PREPARING',
    'ready': 'READY',
    'completed': 'COMPLETED',
    'cancelled': 'CANCELLED',
  };
  
  return statusMap[status?.toLowerCase()] || 'PENDING';
}
