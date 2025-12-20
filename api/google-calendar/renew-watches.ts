import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { GoogleCalendarService } from '../../../services/googleCalendarService';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey.padEnd(32).slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function generateChannelToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

async function getGoogleCalendarTokens(tenantId: string): Promise<{ accessToken: string; refreshToken: string } | null> {
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
    const decrypted = decrypt(data.encrypted_key);
    const tokens = JSON.parse(decrypted);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
  } catch (err) {
    console.error('Error decrypting Google Calendar tokens:', err);
    return null;
  }
}

/**
 * Renew expiring Google Calendar watch channels
 * This endpoint should be called daily via Vercel Cron Jobs
 * GET /api/google-calendar/renew-watches?cron_secret=xxx
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional: Add cron secret for security
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.query.cron_secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find watches expiring within 2 days
    const twoDaysFromNow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: expiringWatches, error: watchesError } = await supabase
      .from('google_calendar_watches')
      .select('*')
      .lt('expiration', twoDaysFromNow)
      .order('expiration', { ascending: true });

    if (watchesError) {
      throw new Error(`Failed to query watches: ${watchesError.message}`);
    }

    if (!expiringWatches || expiringWatches.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No watches need renewal',
        renewed: 0,
      });
    }

    let renewed = 0;
    let failed = 0;

    for (const watch of expiringWatches) {
      try {
        // Get tokens
        const tokens = await getGoogleCalendarTokens(watch.tenant_id);
        if (!tokens) {
          console.warn(`No tokens for tenant ${watch.tenant_id}, skipping watch ${watch.id}`);
          failed++;
          continue;
        }

        const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);

        // Stop old watch
        try {
          await calendarService.stopWatch(watch.channel_id, watch.resource_id || '');
        } catch (stopError) {
          console.warn(`Error stopping old watch ${watch.channel_id}:`, stopError);
          // Continue anyway
        }

        // Generate new channel ID and token
        const newChannelId = `menyo_${watch.restaurant_id}_${Date.now()}`;
        const newChannelToken = generateChannelToken();

        // Calculate new expiration (7 days)
        const expirationSeconds = 604800;
        const newExpiration = new Date(Date.now() + expirationSeconds * 1000);

        // Get webhook URL from request origin or environment
        const webhookUrl = process.env.WEBHOOK_BASE_URL 
          ? `${process.env.WEBHOOK_BASE_URL}/api/google-calendar/webhook`
          : `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/google-calendar/webhook`;

        // Create new watch
        const watchResponse = await calendarService.watchEvents(watch.calendar_id, {
          id: newChannelId,
          type: 'web_hook',
          address: webhookUrl,
          token: newChannelToken,
          expiration: newExpiration.getTime(),
        });

        // Update watch record
        const { error: updateError } = await supabase
          .from('google_calendar_watches')
          .update({
            channel_id: newChannelId,
            resource_id: watchResponse.resourceId,
            channel_token: newChannelToken,
            expiration: newExpiration.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', watch.id);

        if (updateError) {
          throw new Error(`Failed to update watch: ${updateError.message}`);
        }

        renewed++;
        console.log(`Renewed watch for restaurant ${watch.restaurant_id}, calendar ${watch.calendar_id}`);
      } catch (error: any) {
        console.error(`Error renewing watch ${watch.id}:`, error);
        failed++;
      }
    }

    return res.status(200).json({
      success: true,
      renewed,
      failed,
      total: expiringWatches.length,
      message: `Renewed ${renewed} watch channels, ${failed} failed`,
    });
  } catch (error: any) {
    console.error('Error in watch renewal:', error);
    return res.status(500).json({
      error: error.message || 'Failed to renew watches',
    });
  }
}
