import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCalendarWebhook } from '../../../lib/calendarSync';
import { triggerWebhookSubscriptions } from '../../../lib/webhookTriggers';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Webhook endpoint to receive Google Calendar push notifications
 * POST /api/google-calendar/webhook
 * 
 * Google sends notifications when calendar events change.
 * We validate the token, then fetch event details and sync to our database.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract channel token from header (Google sends this)
    const channelToken = req.headers['x-goog-channel-token'] as string;
    const resourceId = req.body?.resourceId || req.body?.resourceState;

    if (!channelToken || !resourceId) {
      console.warn('Missing channel token or resource ID in webhook');
      return res.status(400).json({ error: 'Missing required headers or body' });
    }

    // Find watch record by resource_id
    const { data: watch, error: watchError } = await supabase
      .from('google_calendar_watches')
      .select('*')
      .eq('resource_id', resourceId)
      .single();

    if (watchError || !watch) {
      console.warn(`Watch not found for resource_id: ${resourceId}`);
      // Still return 200 to acknowledge receipt (Google will retry if we return error)
      return res.status(200).json({ received: true, message: 'Watch not found' });
    }

    // Validate token
    if (watch.channel_token !== channelToken) {
      console.warn(`Invalid channel token for resource_id: ${resourceId}`);
      return res.status(401).json({ error: 'Invalid channel token' });
    }

    // Check if watch is expired
    if (new Date(watch.expiration) < new Date()) {
      console.warn(`Watch expired for resource_id: ${resourceId}`);
      return res.status(200).json({ received: true, message: 'Watch expired' });
    }

    // Handle the webhook notification
    await handleCalendarWebhook(
      resourceId,
      channelToken,
      watch.restaurant_id,
      watch.tenant_id
    );

    // Trigger Make.com/n8n webhooks if configured
    try {
      await triggerWebhookSubscriptions(
        watch.restaurant_id,
        watch.tenant_id,
        'reservation.updated', // Google Calendar change triggers update
        { source: 'google_calendar', resource_id: resourceId }
      );
    } catch (webhookError) {
      console.error('Error triggering webhook subscriptions:', webhookError);
      // Don't fail the request if webhook triggers fail
    }

    return res.status(200).json({ 
      received: true,
      message: 'Webhook processed successfully',
      resource_id: resourceId,
    });
  } catch (error: any) {
    console.error('Error processing Google Calendar webhook:', error);
    // Return 200 to acknowledge receipt (Google will retry on 5xx)
    // But log the error for debugging
    return res.status(200).json({ 
      received: true,
      error: 'Processing failed, will retry',
      message: error.message,
    });
  }
}
