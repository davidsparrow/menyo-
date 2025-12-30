import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createEmailService } from '../../services/emailService';
import type { RestaurantProfile } from '../../types';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Email-Only Order Endpoint (Path A)
 * Handles orders for restaurants using EMAIL_ONLY mode
 * - No payment processing
 * - Orders sent directly to owner's email
 * - Immediate confirmation (no external API calls)
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

    // 3. Verify Email-Only mode is enabled
    if (profileData.orderHandlingMode !== 'EMAIL_ONLY') {
      return res.status(400).json({
        error: 'Email-only orders not enabled. Current mode: ' + profileData.orderHandlingMode
      });
    }

    if (!profileData.emailOrderSettings?.deliveryEmail) {
      return res.status(400).json({
        error: 'Email order settings not configured. Please set delivery email in Settings.'
      });
    }

    // 4. Validate order data
    const {
      customerName,
      phone,
      email,
      items,
      orderType,
      deliveryAddress,
      specialInstructions,
    } = req.body;

    if (!customerName || !phone || !items || items.length === 0 || !orderType) {
      return res.status(400).json({
        error: 'Missing required fields: customerName, phone, items, orderType'
      });
    }

    if (!['DINE_IN', 'PICKUP', 'DELIVERY'].includes(orderType)) {
      return res.status(400).json({
        error: 'Invalid orderType. Must be DINE_IN, PICKUP, or DELIVERY'
      });
    }

    if (orderType === 'DELIVERY' && !deliveryAddress) {
      return res.status(400).json({
        error: 'Delivery address required for delivery orders'
      });
    }

    // Check if order type is enabled
    const settings = profileData.emailOrderSettings;
    if (orderType === 'DINE_IN' && !settings.enableDineIn) {
      return res.status(400).json({ error: 'Dine-in orders are not enabled' });
    }
    if (orderType === 'PICKUP' && !settings.enablePickup) {
      return res.status(400).json({ error: 'Pickup orders are not enabled' });
    }
    if (orderType === 'DELIVERY' && !settings.enableDelivery) {
      return res.status(400).json({ error: 'Delivery orders are not enabled' });
    }

    // 5. Generate order ID
    const orderId = `EMAIL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    // 6. Store order in database
    const { error: orderInsertError } = await supabase
      .from('orders')
      .insert({
        id: orderId,
        restaurant_id: restaurant.id,
        tenant_id: restaurant.tenant_id,
        customer_name: customerName,
        phone,
        email,
        items: JSON.stringify(items), // Store as JSON string
        order_type: orderType,
        delivery_address: deliveryAddress,
        total: 0, // No payment processing in email mode
        status: 'CONFIRMED', // Email orders are immediately confirmed
        special_instructions: specialInstructions,
        created_at: timestamp,
        updated_at: timestamp,
      });

    if (orderInsertError) {
      console.error('Error inserting order:', orderInsertError);
      return res.status(500).json({ error: 'Failed to save order' });
    }

    // 7. Send email to restaurant owner
    const emailService = createEmailService();
    const emailResult = await emailService.sendEmailOnlyOrder(
      settings.deliveryEmail,
      {
        orderId,
        customerName,
        phone,
        email,
        items: items.map((item: any) => ({
          itemName: item.itemName || item.name,
          quantity: item.quantity || 1,
          description: item.description || item.specialInstructions || '',
        })),
        orderType,
        deliveryAddress,
        specialInstructions,
        timestamp,
      }
    );

    if (!emailResult.success) {
      console.error('Email send failed:', emailResult.error);
      // Order is saved, but email failed - return partial success
      return res.status(207).json({
        order: {
          orderId,
          status: 'CONFIRMED',
          timestamp,
        },
        warning: 'Order saved but email notification failed. Please check your email settings.',
        emailError: emailResult.error,
      });
    }

    // 8. Return success response
    return res.status(200).json({
      success: true,
      order: {
        orderId,
        status: 'CONFIRMED',
        timestamp,
        orderType,
        customerName,
        phone,
        email,
        items,
        deliveryAddress,
        specialInstructions,
      },
      message: 'Order received! We\'ll contact you shortly to confirm.',
    });

  } catch (error: any) {
    console.error('Error processing email order:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
