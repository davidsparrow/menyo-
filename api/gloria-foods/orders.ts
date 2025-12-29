import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createGloriaFoodsService, OrderData } from '../../../services/gloriaFoodsService';

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

async function getGloriaFoodsToken(tenantId: string): Promise<string | null> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('encrypted_key')
    .eq('tenant_id', tenantId)
    .eq('key_type', 'gloria_foods')
    .single();

  if (error || !data) {
    return null;
  }

  try {
    return decrypt(data.encrypted_key);
  } catch (err) {
    console.error('Error decrypting Gloria Foods token:', err);
    return null;
  }
}

async function getGloriaFoodsMasterKey(tenantId: string): Promise<string | null> {
  // First try to get from api_keys table
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('encrypted_key')
    .eq('tenant_id', tenantId)
    .eq('key_type', 'gloria_foods_master')
    .single();

  if (!error && data) {
    try {
      return decrypt(data.encrypted_key);
    } catch (err) {
      console.error('Error decrypting Gloria Foods master key:', err);
    }
  }

  // Fallback to environment variable (shared master key)
  return process.env.GLORIA_FOODS_MASTER_KEY || null;
}

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
      // Check if Orders integration is enabled
      const { data: restaurantData } = await supabase
        .from('restaurants')
        .select('id, profile_data')
        .eq('tenant_id', tenantId)
        .single();

      if (!restaurantData) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      const profileData = (restaurantData.profile_data as any) || {};
      if (!profileData.integrations?.gloriaFoodsOrders) {
        return res.status(404).json({ error: 'Gloria Foods Orders integration not enabled. Please enable it in Settings.' });
      }

      // Get order method preference (default to HYBRID)
      const orderMethod = profileData.gloriaFoodsOrderMethod || 'HYBRID';

      // Get Gloria Foods token
      const gloriaToken = await getGloriaFoodsToken(tenantId!);
      if (!gloriaToken) {
        return res.status(404).json({ error: 'Gloria Foods API token not found. Please add your API token in Settings.' });
      }

      // Get master key for PUSH method
      const masterKey = orderMethod === 'PUSH' ? await getGloriaFoodsMasterKey(tenantId!) : undefined;
      if (orderMethod === 'PUSH' && !masterKey) {
        return res.status(400).json({ error: 'Master key required for PUSH method. Please configure GLORIA_FOODS_MASTER_KEY.' });
      }

      // Validate request body
      const orderData: OrderData = req.body;
      if (!orderData.customerName || !orderData.phone || !orderData.items || orderData.items.length === 0) {
        return res.status(400).json({ error: 'Missing required fields: customerName, phone, and items are required' });
      }

      // Get GF restaurant_id from profile if available
      const gfRestaurantId = profileData.gloriaFoodsRestaurantId 
        ? parseInt(String(profileData.gloriaFoodsRestaurantId)) 
        : undefined;

      // Create service instance
      const gloriaService = createGloriaFoodsService(gloriaToken, masterKey);

      let orderResult: any;
      let orderStatus: 'PENDING' | 'CONFIRMED' = 'PENDING';
      let gloriaFoodsOrderId: string;

      if (orderMethod === 'PUSH') {
        // PUSH method: Submit order directly to GF API
        const submittedOrder = await gloriaService.submitOrder(orderData, gfRestaurantId);
        gloriaFoodsOrderId = submittedOrder.orderId;
        orderStatus = submittedOrder.status;
        orderResult = {
          orderId: submittedOrder.orderId,
          status: submittedOrder.status,
          total: submittedOrder.total,
          estimatedReadyTime: submittedOrder.estimatedReadyTime,
          method: 'PUSH',
        };
      } else {
        // HYBRID method: Prepare order and return checkout URL
        const preparedOrder = await gloriaService.prepareOrder(orderData);
        gloriaFoodsOrderId = preparedOrder.orderId;
        orderResult = {
          orderId: preparedOrder.orderId,
          checkoutUrl: preparedOrder.checkoutUrl,
          total: preparedOrder.total,
          estimatedReadyTime: preparedOrder.estimatedReadyTime,
          method: 'HYBRID',
        };
      }

      // Store order in database for tracking
      const { error: insertError } = await supabase
        .from('orders')
        .insert({
          restaurant_id: restaurantData.id,
          tenant_id: tenantId,
          gloria_foods_order_id: gloriaFoodsOrderId,
          customer_name: orderData.customerName,
          phone: orderData.phone,
          email: orderData.email,
          items: orderData.items,
          order_type: orderData.orderType,
          delivery_address: orderData.deliveryAddress,
          total: orderResult.total,
          status: orderStatus,
          checkout_url: orderMethod === 'HYBRID' ? orderResult.checkoutUrl : null,
          estimated_ready_time: orderResult.estimatedReadyTime,
          special_instructions: orderData.specialInstructions,
        });

      if (insertError) {
        console.error('Error storing order in database:', insertError);
        // Continue anyway - order is processed, just not tracked in DB
      }

      // Send email notification for PUSH method (order is immediately confirmed)
      if (orderMethod === 'PUSH' && orderStatus === 'CONFIRMED') {
        try {
          const ownerEmail = profileData.ownerEmail;
          if (ownerEmail) {
            const { createEmailService } = await import('../../services/emailService');
            const emailService = createEmailService();
            
            await emailService.sendOrderNotification(ownerEmail, {
              orderId: gloriaFoodsOrderId,
              customerName: orderData.customerName,
              phone: orderData.phone,
              email: orderData.email,
              items: orderData.items.map(item => ({
                itemName: item.itemName,
                quantity: item.quantity,
                price: item.price,
              })),
              total: orderResult.total,
              orderType: orderData.orderType,
              estimatedReadyTime: orderResult.estimatedReadyTime,
              specialInstructions: orderData.specialInstructions,
            });
          }
        } catch (emailError) {
          console.error('Error sending order notification email:', emailError);
          // Don't fail order if email fails
        }
      }

      return res.status(200).json({
        success: true,
        order: orderResult,
        message: orderMethod === 'PUSH' 
          ? `Order #${gloriaFoodsOrderId} confirmed successfully!`
          : 'Order prepared successfully. Redirect customer to checkout URL for payment.',
      });
    } catch (error: any) {
      console.error('Error processing order:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to process order' 
      });
    }
  }

  if (req.method === 'GET') {
    try {
      // Get order status
      const { orderId } = req.query;
      if (!orderId || typeof orderId !== 'string') {
        return res.status(400).json({ error: 'orderId query parameter is required' });
      }

      // Get Gloria Foods token
      const gloriaToken = await getGloriaFoodsToken(tenantId!);
      if (!gloriaToken) {
        return res.status(404).json({ error: 'Gloria Foods not connected' });
      }

      // Create service instance
      const gloriaService = createGloriaFoodsService(gloriaToken);
      
      // Get order status
      const orderStatus = await gloriaService.getOrderStatus(orderId);

      return res.status(200).json({
        orderStatus,
      });
    } catch (error: any) {
      console.error('Error fetching order status:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to fetch order status' 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

