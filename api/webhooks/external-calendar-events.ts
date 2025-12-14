import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Public webhook endpoint for Make.com/n8n
 * POST /api/webhooks/external-calendar-events - Receive webhook subscriptions
 * GET /api/webhooks/external-calendar-events - List subscribed webhooks (admin)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (req.method === 'POST') {
    // Public webhook - no auth required (webhook URL is secret)
    // Validate webhook URL and secret token from query params or body
    const { webhook_url, secret_token, event_types } = req.body;

    if (!webhook_url) {
      return res.status(400).json({ error: 'webhook_url is required' });
    }

    // Extract restaurant_id from webhook URL or use a separate parameter
    // For security, webhook URLs should be registered via authenticated endpoint
    // This is a simplified version - in production, use authenticated registration
    const restaurantId = req.body.restaurant_id || req.query.restaurant_id;
    const tenantId = req.body.tenant_id || req.query.tenant_id;

    if (!restaurantId || !tenantId) {
      return res.status(400).json({ error: 'restaurant_id and tenant_id are required' });
    }

    // Generate secret token if not provided
    const finalSecretToken = secret_token || generateRandomToken(32);

    // Store webhook subscription
    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .insert({
        restaurant_id: restaurantId,
        tenant_id: tenantId,
        webhook_url,
        event_types: event_types || ['reservation.created', 'reservation.updated', 'reservation.cancelled'],
        secret_token: finalSecretToken,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating webhook subscription:', error);
      return res.status(500).json({ error: 'Failed to create webhook subscription' });
    }

    return res.status(201).json({
      success: true,
      id: data.id,
      webhook_url: data.webhook_url,
      secret_token: data.secret_token, // Return token for client to store
    });
  }

  if (req.method === 'GET') {
    // List webhooks (requires authentication)
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

    const { data: webhooks, error } = await supabase
      .from('webhook_subscriptions')
      .select('id, webhook_url, event_types, is_active, created_at')
      .eq('tenant_id', tenantId);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch webhooks' });
    }

    return res.status(200).json({ webhooks });
  }

  if (req.method === 'DELETE') {
    // Delete webhook subscription (requires authentication)
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'id query parameter is required' });
    }

    const { error: deleteError } = await supabase
      .from('webhook_subscriptions')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return res.status(500).json({ error: 'Failed to delete webhook subscription' });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

/**
 * Publish event to subscribed webhooks
 * Called internally when reservation events occur
 */
export async function publishWebhookEvent(
  restaurantId: string,
  tenantId: string,
  eventType: 'reservation.created' | 'reservation.updated' | 'reservation.cancelled',
  reservation: any
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get active webhook subscriptions for this restaurant
  const { data: webhooks, error } = await supabase
    .from('webhook_subscriptions')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (error || !webhooks || webhooks.length === 0) {
    return; // No webhooks to notify
  }

  // Filter webhooks that subscribe to this event type
  const relevantWebhooks = webhooks.filter(webhook =>
    webhook.event_types.includes(eventType)
  );

  // Send webhook notifications (fire and forget)
  for (const webhook of relevantWebhooks) {
    fetch(webhook.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${webhook.secret_token}`,
        'X-Webhook-Event': eventType,
      },
      body: JSON.stringify({
        event: eventType,
        reservation,
        timestamp: new Date().toISOString(),
      }),
    }).catch(error => {
      console.error(`Error sending webhook to ${webhook.webhook_url}:`, error);
      // Could mark webhook as inactive after multiple failures
    });
  }
}

function generateRandomToken(length: number = 32): string {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex');
}
