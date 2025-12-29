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
  // Webhooks from Gloria Foods include the Master API Key in the Authorization header
  // Extract the key from the Authorization header
  const authHeader = req.headers['authorization'] as string;
  const masterKey = authHeader; // GloriaFood sends the raw master key in Authorization header
  const expectedMasterKey = process.env.GLORIA_FOODS_MASTER_KEY;

  // Verify master key if configured
  if (expectedMasterKey && masterKey !== expectedMasterKey) {
    console.error('Webhook authentication failed:', {
      received: masterKey ? 'Key received' : 'No key',
      expected: expectedMasterKey ? 'Key configured' : 'No key configured'
    });
    return res.status(401).json({ error: 'Unauthorized: Invalid master key' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const webhookData = req.body;

    // GloriaFood webhook payload structure (based on API V2 documentation)
    const {
      id,                      // Order ID
      restaurant_id,
      client_first_name,
      client_last_name,
      client_email,
      client_phone,
      type,                    // pickup, delivery, table_reservation, order_ahead, dine_in
      status,                  // accepted, rejected, timed_out, pending, canceled
      total_price,
      items,
      fulfill_at,              // UTC timestamp (estimated ready time)
      delivery_address,
      special_instructions,
    } = webhookData;

    if (!id) {
      return res.status(400).json({ error: 'Missing order id in webhook payload' });
    }

    const order_id = id; // Use GloriaFood's 'id' field as order_id
    const customer_name = `${client_first_name || ''} ${client_last_name || ''}`.trim();
    const customer_phone = client_phone;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find restaurant by restaurant_id (Gloria Foods restaurant ID)
    // Optimized lookup: Query restaurants and filter by gloriaFoodsRestaurantId in profile_data
    const { data: restaurants, error: restaurantsError } = await supabase
      .from('restaurants')
      .select('id, tenant_id, profile_data');

    if (restaurantsError) {
      console.error('Error querying restaurants:', restaurantsError);
      return res.status(500).json({ error: 'Failed to query restaurants' });
    }

    // Find matching restaurant by gloriaFoodsRestaurantId
    let matchingRestaurant = null;
    if (restaurants) {
      for (const restaurant of restaurants) {
        const profile = restaurant.profile_data as any;
        // Match by stored GF restaurant_id or try to match by restaurant_id from webhook
        if (profile?.gloriaFoodsRestaurantId === restaurant_id || 
            String(profile?.gloriaFoodsRestaurantId) === String(restaurant_id)) {
          matchingRestaurant = restaurant;
          break;
        }
      }
    }

    if (!matchingRestaurant) {
      console.warn(`No matching restaurant found for Gloria Foods restaurant_id: ${restaurant_id}`);
      // Still return 200 to acknowledge webhook receipt (GF will retry if we return error)
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
      email: client_email,
      items: items || [],
      order_type: type?.toUpperCase() || 'PICKUP',
      delivery_address: delivery_address,
      total: total_price || 0,
      status: mapGloriaFoodsStatus(status),
      estimated_ready_time: fulfill_at,
      actual_ready_time: null, // Will be updated when order is completed
      special_instructions: special_instructions,
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

    // Send email notification to restaurant owner on order confirmation
    if (status === 'accepted' || status === 'confirmed') {
      try {
        const profile = matchingRestaurant.profile_data as any;
        const ownerEmail = profile?.ownerEmail;
        
        if (ownerEmail) {
          const { createEmailService } = await import('../../services/emailService');
          const emailService = createEmailService();
          
          await emailService.sendOrderNotification(ownerEmail, {
            orderId: order_id,
            customerName: customer_name,
            phone: customer_phone,
            email: client_email,
            items: (items || []).map((item: any) => ({
              itemName: item.name || item.item_name || 'Item',
              quantity: item.quantity || 1,
              price: item.price || 0,
            })),
            total: total_price || 0,
            orderType: type || 'pickup',
            estimatedReadyTime: fulfill_at,
            specialInstructions: special_instructions,
          });
        }
      } catch (emailError) {
        console.error('Error sending order notification email:', emailError);
        // Don't fail webhook if email fails
      }
    }

    // Handle specific order statuses (e.g., trigger AI voice call when order is ready)
    if (status === 'ready' && customer_phone) {
      // TODO: Trigger AI voice call to customer
      // This would integrate with Twilio and Gemini Live API
      console.log(`Order ${order_id} is ready! Should call customer at ${customer_phone}`);
    }

    // Log webhook receipt for debugging
    console.log('GloriaFood webhook processed:', {
      order_id,
      restaurant_id,
      status,
      customer_name,
      total: total_price,
    });

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

