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
        .select('profile_data')
        .eq('tenant_id', tenantId)
        .single();

      const profileData = (restaurantData?.profile_data as any) || {};
      if (!profileData.integrations?.gloriaFoodsOrders) {
        return res.status(404).json({ error: 'Gloria Foods Orders integration not enabled. Please enable it in Settings.' });
      }

      // Get Gloria Foods token
      const gloriaToken = await getGloriaFoodsToken(tenantId!);
      if (!gloriaToken) {
        return res.status(404).json({ error: 'Gloria Foods API token not found. Please add your API token in Settings.' });
      }

      // Validate request body
      const orderData: OrderData = req.body;
      if (!orderData.customerName || !orderData.phone || !orderData.items || orderData.items.length === 0) {
        return res.status(400).json({ error: 'Missing required fields: customerName, phone, and items are required' });
      }

      // Create service instance
      const gloriaService = createGloriaFoodsService(gloriaToken);
      
      // Prepare order (hybrid approach - returns checkout URL)
      const preparedOrder = await gloriaService.prepareOrder(orderData);

      // Store order in database for tracking
      const { data: restaurantData } = await supabase
        .from('restaurants')
        .select('id')
        .eq('tenant_id', tenantId)
        .single();

      if (restaurantData) {
        // Insert order into database
        const { error: insertError } = await supabase
          .from('orders')
          .insert({
            restaurant_id: restaurantData.id,
            tenant_id: tenantId,
            gloria_foods_order_id: preparedOrder.orderId,
            customer_name: orderData.customerName,
            phone: orderData.phone,
            email: orderData.email,
            items: orderData.items,
            order_type: orderData.orderType,
            delivery_address: orderData.deliveryAddress,
            total: preparedOrder.total,
            status: 'PENDING',
            checkout_url: preparedOrder.checkoutUrl,
            estimated_ready_time: preparedOrder.estimatedReadyTime,
            special_instructions: orderData.specialInstructions,
          });

        if (insertError) {
          console.error('Error storing order in database:', insertError);
          // Continue anyway - order is prepared, just not tracked in DB
        }
      }

      return res.status(200).json({
        success: true,
        order: preparedOrder,
        message: 'Order prepared successfully. Redirect customer to checkout URL for payment.',
      });
    } catch (error: any) {
      console.error('Error preparing order:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to prepare order' 
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

