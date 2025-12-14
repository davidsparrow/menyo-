import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleCalendarService } from '../../../services/googleCalendarService';
import crypto from 'crypto';

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

function generateRandomToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Scheduled job to renew Google Calendar watch channels
 * Runs daily to check for watches expiring within 24-48 hours
 * Automatically renews watches before expiration
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional: Add authentication for manual triggers
  const secretToken = req.headers['x-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && secretToken !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Find watches expiring within 2 days
    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
    
    const { data: expiringWatches, error: fetchError } = await supabase
      .from('google_calendar_watches')
      .select('*')
      .lte('expiration', twoDaysFromNow.toISOString())
      .order('expiration', { ascending: true });

    if (fetchError) {
      console.error('Error fetching expiring watches:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch expiring watches' });
    }

    if (!expiringWatches || expiringWatches.length === 0) {
      return res.status(200).json({ renewed: 0, message: 'No watches need renewal' });
    }

    let renewed = 0;
    let failed = 0;

    for (const watch of expiringWatches) {
      try {
        // Get Google Calendar tokens
        const { data: apiKeyData } = await supabase
          .from('api_keys')
          .select('encrypted_key')
          .eq('tenant_id', watch.tenant_id)
          .eq('key_type', 'google_calendar')
          .single();

        if (!apiKeyData) {
          console.warn(`No Google Calendar tokens found for tenant ${watch.tenant_id}`);
          failed++;
          continue;
        }

        const refreshToken = decrypt(apiKeyData.encrypted_key);
        const service = new GoogleCalendarService('', refreshToken, googleClientId, googleClientSecret);
        await service.refreshAccessToken();

        // Stop old watch
        if (watch.resource_id) {
          try {
            await service.stopWatch(watch.channel_id, watch.resource_id);
          } catch (stopError) {
            // Continue even if stop fails (watch may already be expired)
            console.warn(`Error stopping watch ${watch.channel_id}:`, stopError);
          }
        }

        // Create new watch
        const webhookUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/google-calendar/webhook`;
        const newChannelId = `menyo-${watch.restaurant_id}-${Date.now()}`;
        const newChannelToken = generateRandomToken(32);
        const expiration = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days from now

        const watchRequest = {
          id: newChannelId,
          type: 'web_hook' as const,
          address: webhookUrl,
          token: newChannelToken,
          expiration: expiration,
        };

        const newWatchChannel = await service.watchEvents(watch.calendar_id, watchRequest);

        // Update watch in database
        const { error: updateError } = await supabase
          .from('google_calendar_watches')
          .update({
            channel_id: newChannelId,
            resource_id: newWatchChannel.resourceId,
            channel_token: newChannelToken,
            expiration: new Date(newWatchChannel.expiration).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', watch.id);

        if (updateError) {
          throw new Error(`Failed to update watch: ${updateError.message}`);
        }

        renewed++;
        console.log(`Renewed watch ${watch.id} for restaurant ${watch.restaurant_id}`);
      } catch (error: any) {
        console.error(`Error renewing watch ${watch.id}:`, error);
        failed++;
        // Continue with other watches
      }
    }

    return res.status(200).json({
      renewed,
      failed,
      total: expiringWatches.length,
    });
  } catch (error: any) {
    console.error('Error in watch renewal job:', error);
    return res.status(500).json({
      error: 'Failed to renew watches',
      message: error.message,
    });
  }
}
