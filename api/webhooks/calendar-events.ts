import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Webhook subscription management for Make.com/n8n
 * POST /api/webhooks/calendar-events - Subscribe webhook URL
 * GET /api/webhooks/calendar-events - List subscriptions
 * DELETE /api/webhooks/calendar-events - Remove subscription
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

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

  // Get restaurant for this tenant
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('id')
    .eq('tenant_id', tenantId)
    .single();

  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }

  if (req.method === 'POST') {
    try {
      const { webhook_url, event_types, secret_token } = req.body;

      if (!webhook_url || !event_types || !Array.isArray(event_types) || event_types.length === 0) {
        return res.status(400).json({ 
          error: 'webhook_url and event_types (array) are required' 
        });
      }

      // Generate secret token if not provided
      const finalSecretToken = secret_token || crypto.randomBytes(32).toString('hex');

      const { data: subscription, error: insertError } = await supabase
        .from('webhook_subscriptions')
        .insert({
          restaurant_id: restaurant.id,
          tenant_id: tenantId,
          webhook_url,
          event_types,
          secret_token: finalSecretToken,
          is_active: true,
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Failed to create subscription: ${insertError.message}`);
      }

      return res.status(201).json({
        success: true,
        subscription: {
          id: subscription.id,
          webhook_url: subscription.webhook_url,
          event_types: subscription.event_types,
          // Don't return secret_token in response
        },
        message: 'Webhook subscription created successfully',
      });
    } catch (error: any) {
      console.error('Error creating webhook subscription:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to create webhook subscription' 
      });
    }
  }

  if (req.method === 'GET') {
    try {
      const { data: subscriptions, error } = await supabase
        .from('webhook_subscriptions')
        .select('id, webhook_url, event_types, is_active, created_at')
        .eq('restaurant_id', restaurant.id)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to list subscriptions: ${error.message}`);
      }

      return res.status(200).json({
        subscriptions: subscriptions || [],
      });
    } catch (error: any) {
      console.error('Error listing webhook subscriptions:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to list webhook subscriptions' 
      });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { subscription_id } = req.query;

      if (!subscription_id) {
        return res.status(400).json({ error: 'subscription_id is required' });
      }

      const { error: deleteError } = await supabase
        .from('webhook_subscriptions')
        .delete()
        .eq('id', subscription_id)
        .eq('restaurant_id', restaurant.id);

      if (deleteError) {
        throw new Error(`Failed to delete subscription: ${deleteError.message}`);
      }

      return res.status(200).json({
        success: true,
        message: 'Webhook subscription deleted successfully',
      });
    } catch (error: any) {
      console.error('Error deleting webhook subscription:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to delete webhook subscription' 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
