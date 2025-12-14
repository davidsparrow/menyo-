import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { GoogleCalendarService } from '../../../services/googleCalendarService.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
const googleClientId = process.env.GOOGLE_CLIENT_ID!;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!;

function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey.padEnd(32).slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function getGoogleCalendarTokens(tenantId: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('encrypted_key')
    .eq('tenant_id', tenantId)
    .eq('key_type', 'google_calendar')
    .single();

  if (error || !data) {
    return null;
  }

  try {
    const refreshToken = decrypt(data.encrypted_key);
    const service = new GoogleCalendarService('', refreshToken, googleClientId, googleClientSecret);
    const accessToken = await service.refreshAccessToken();
    return { accessToken, refreshToken };
  } catch (err) {
    console.error('Error getting Google Calendar tokens:', err);
    return null;
  }
}

/**
 * Webhook endpoint to receive push notifications from Google Calendar
 * Validates security token and processes event changes
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate security token
    const channelToken = req.headers['x-goog-channel-token'] as string;
    if (!channelToken) {
      return res.status(401).json({ error: 'Missing channel token' });
    }

    // Extract resourceId from notification
    const { resourceId, resourceState, resourceUri } = req.body;
    
    if (!resourceId) {
      return res.status(400).json({ error: 'Missing resourceId in notification' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up watch record by resource_id
    const { data: watch, error: watchError } = await supabase
      .from('google_calendar_watches')
      .select('*, restaurant_id, tenant_id, calendar_id')
      .eq('resource_id', resourceId)
      .single();

    if (watchError || !watch) {
      console.warn(`Watch not found for resourceId: ${resourceId}`);
      // Return 200 to acknowledge receipt (don't want Google to retry)
      return res.status(200).json({ received: true, message: 'Watch not found' });
    }

    // Validate token
    if (watch.channel_token !== channelToken) {
      console.warn(`Invalid channel token for resourceId: ${resourceId}`);
      return res.status(401).json({ error: 'Invalid channel token' });
    }

    // Handle sync notification
    if (resourceState === 'sync') {
      // Initial sync notification - fetch all events
      // This is handled separately, just acknowledge
      return res.status(200).json({ received: true, state: 'sync' });
    }

    if (resourceState === 'exists') {
      // Event was created or updated - fetch event details
      try {
        const tokens = await getGoogleCalendarTokens(watch.tenant_id);
        if (!tokens) {
          console.error('No tokens found for tenant:', watch.tenant_id);
          // Queue for retry
          await queueSyncOperation(watch.restaurant_id, watch.tenant_id, 'sync_from_google', {
            calendar_id: watch.calendar_id,
            resource_uri: resourceUri,
          });
          return res.status(200).json({ received: true, queued: true });
        }

        const service = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken, googleClientId, googleClientSecret);
        
        // Extract event ID from resourceUri
        const eventIdMatch = resourceUri?.match(/\/events\/([^?]+)/);
        if (!eventIdMatch) {
          return res.status(400).json({ error: 'Could not extract event ID from resourceUri' });
        }

        const eventId = eventIdMatch[1];
        const event = await service.getEvent(watch.calendar_id, eventId);

        // Import calendarSync function (will be created next)
        const { syncGoogleEventToReservation } = await import('../../../lib/calendarSync.js');
        await syncGoogleEventToReservation(event, watch.restaurant_id, watch.tenant_id, watch.calendar_id);

        return res.status(200).json({ received: true, processed: true });
      } catch (error: any) {
        console.error('Error processing webhook:', error);
        // Queue for retry
        await queueSyncOperation(watch.restaurant_id, watch.tenant_id, 'sync_from_google', {
          calendar_id: watch.calendar_id,
          resource_uri: resourceUri,
        });
        return res.status(200).json({ received: true, queued: true });
      }
    }

    if (resourceState === 'not_exists') {
      // Event was deleted
      // We'll handle this by checking if reservation exists and marking as cancelled
      // For now, just acknowledge
      return res.status(200).json({ received: true, state: 'deleted' });
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('Error processing Google Calendar webhook:', error);
    // Always return 200 to acknowledge receipt (don't want Google to retry)
    return res.status(200).json({ received: true, error: error.message });
  }
}

/**
 * Queue a sync operation for retry
 */
async function queueSyncOperation(
  restaurantId: string,
  tenantId: string,
  operationType: string,
  payload: any
): Promise<void> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Calculate next retry with exponential backoff (1 minute initially)
  const nextRetryAt = new Date(Date.now() + 60 * 1000);

  await supabase
    .from('sync_queue')
    .insert({
      restaurant_id: restaurantId,
      tenant_id: tenantId,
      operation_type: operationType,
      payload,
      next_retry_at: nextRetryAt.toISOString(),
      status: 'PENDING',
    });
}
