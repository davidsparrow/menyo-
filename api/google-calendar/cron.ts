import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleCalendarService } from '../../../services/googleCalendarService.js';
import { syncGoogleEventToReservation, syncReservationToGoogleCalendar, deleteGoogleCalendarEvent } from '../../../lib/calendarSync.js';
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
 * Combined cron job endpoint for Google Calendar
 * Handles both sync queue processing and watch renewal
 * 
 * Query params:
 * - job=sync-queue: Process sync queue
 * - job=renew-watches: Renew expiring watches
 * - job=all: Run both (default)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secretToken = req.headers['x-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && secretToken !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const job = (req.query.job as string) || 'all';
  const results: any = {};

  if (job === 'sync-queue' || job === 'all') {
    results.syncQueue = await processSyncQueue();
  }

  if (job === 'renew-watches' || job === 'all') {
    results.renewWatches = await renewWatches(req);
  }

  return res.status(200).json(results);
}

async function processSyncQueue() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: queueItems, error: fetchError } = await supabase
      .from('sync_queue')
      .select('*')
      .eq('status', 'PENDING')
      .lte('next_retry_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error('Error fetching sync queue:', fetchError);
      return { processed: 0, failed: 0, error: fetchError.message };
    }

    if (!queueItems || queueItems.length === 0) {
      return { processed: 0, failed: 0, message: 'No items to process' };
    }

    let processed = 0;
    let failed = 0;

    for (const item of queueItems) {
      try {
        await supabase
          .from('sync_queue')
          .update({ status: 'PROCESSING' })
          .eq('id', item.id);

        let success = false;

        switch (item.operation_type) {
          case 'create_event':
          case 'update_event':
            await syncReservationToGoogleCalendar(
              item.payload.reservation_id,
              item.restaurant_id,
              item.tenant_id
            );
            success = true;
            break;

          case 'delete_event':
            await deleteGoogleCalendarEvent(
              item.payload.reservation_id,
              item.restaurant_id,
              item.tenant_id
            );
            success = true;
            break;

          case 'sync_from_google':
            const tokens = await getGoogleCalendarTokens(item.tenant_id);
            if (tokens) {
              const service = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken, googleClientId, googleClientSecret);
              const eventIdMatch = item.payload.resource_uri?.match(/\/events\/([^?]+)/);
              if (eventIdMatch) {
                const event = await service.getEvent(item.payload.calendar_id, eventIdMatch[1]);
                await syncGoogleEventToReservation(
                  event,
                  item.restaurant_id,
                  item.tenant_id,
                  item.payload.calendar_id
                );
                success = true;
              }
            }
            break;

          default:
            console.warn(`Unknown operation type: ${item.operation_type}`);
            success = false;
        }

        if (success) {
          await supabase
            .from('sync_queue')
            .update({ status: 'COMPLETED' })
            .eq('id', item.id);
          processed++;
        } else {
          throw new Error('Operation failed');
        }
      } catch (error: any) {
        console.error(`Error processing queue item ${item.id}:`, error);

        const retryCount = item.retry_count + 1;
        const maxRetries = item.max_retries || 5;

        if (retryCount >= maxRetries) {
          await supabase
            .from('sync_queue')
            .update({
              status: 'FAILED',
              error_message: error.message,
            })
            .eq('id', item.id);
          failed++;
        } else {
          const backoffMinutes = Math.pow(2, retryCount);
          const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

          await supabase
            .from('sync_queue')
            .update({
              status: 'PENDING',
              retry_count: retryCount,
              next_retry_at: nextRetryAt.toISOString(),
              error_message: error.message,
            })
            .eq('id', item.id);
        }
      }
    }

    return { processed, failed, total: queueItems.length };
  } catch (error: any) {
    console.error('Error processing sync queue:', error);
    return { error: error.message };
  }
}

async function renewWatches(req: VercelRequest) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const twoDaysFromNow = new Date();
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
    
    const { data: expiringWatches, error: fetchError } = await supabase
      .from('google_calendar_watches')
      .select('*')
      .lte('expiration', twoDaysFromNow.toISOString())
      .order('expiration', { ascending: true });

    if (fetchError) {
      console.error('Error fetching expiring watches:', fetchError);
      return { renewed: 0, failed: 0, error: fetchError.message };
    }

    if (!expiringWatches || expiringWatches.length === 0) {
      return { renewed: 0, failed: 0, message: 'No watches need renewal' };
    }

    let renewed = 0;
    let failed = 0;

    for (const watch of expiringWatches) {
      try {
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

        if (watch.resource_id) {
          try {
            await service.stopWatch(watch.channel_id, watch.resource_id);
          } catch (stopError) {
            console.warn(`Error stopping watch ${watch.channel_id}:`, stopError);
          }
        }

        const webhookUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/google-calendar/webhook`;
        const newChannelId = `menyo-${watch.restaurant_id}-${Date.now()}`;
        const newChannelToken = generateRandomToken(32);
        const expiration = Date.now() + (7 * 24 * 60 * 60 * 1000);

        const watchRequest = {
          id: newChannelId,
          type: 'web_hook' as const,
          address: webhookUrl,
          token: newChannelToken,
          expiration: expiration,
        };

        const newWatchChannel = await service.watchEvents(watch.calendar_id, watchRequest);

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
      } catch (error: any) {
        console.error(`Error renewing watch ${watch.id}:`, error);
        failed++;
      }
    }

    return { renewed, failed, total: expiringWatches.length };
  } catch (error: any) {
    console.error('Error in watch renewal:', error);
    return { error: error.message };
  }
}
