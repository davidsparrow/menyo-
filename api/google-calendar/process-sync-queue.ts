import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleCalendarService } from '../../../services/googleCalendarService';
import { syncGoogleEventToReservation, syncReservationToGoogleCalendar, deleteGoogleCalendarEvent } from '../../../lib/calendarSync';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
const googleClientId = process.env.GOOGLE_CLIENT_ID!;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!;

/**
 * Background worker to process sync queue
 * Runs every minute (or via scheduled job) to retry failed operations
 * Implements exponential backoff: 1min, 2min, 4min, 8min, 16min
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional: Add authentication for manual triggers
  // For scheduled jobs, this can be public with a secret token
  const secretToken = req.headers['x-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && secretToken !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get pending operations ready for retry
    const { data: queueItems, error: fetchError } = await supabase
      .from('sync_queue')
      .select('*')
      .eq('status', 'PENDING')
      .lte('next_retry_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(50); // Process up to 50 items at a time

    if (fetchError) {
      console.error('Error fetching sync queue:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch sync queue' });
    }

    if (!queueItems || queueItems.length === 0) {
      return res.status(200).json({ processed: 0, message: 'No items to process' });
    }

    let processed = 0;
    let failed = 0;

    for (const item of queueItems) {
      try {
        // Mark as processing
        await supabase
          .from('sync_queue')
          .update({ status: 'PROCESSING' })
          .eq('id', item.id);

        // Process based on operation type
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
            // This requires fetching the event first
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
          // Mark as completed
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
          // Mark as failed after max retries
          await supabase
            .from('sync_queue')
            .update({
              status: 'FAILED',
              error_message: error.message,
            })
            .eq('id', item.id);
          failed++;
          
          // TODO: Send alert notification (email/webhook)
          console.error(`Queue item ${item.id} failed after ${maxRetries} retries`);
        } else {
          // Calculate next retry with exponential backoff
          const backoffMinutes = Math.pow(2, retryCount); // 1, 2, 4, 8, 16 minutes
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

    return res.status(200).json({
      processed,
      failed,
      total: queueItems.length,
    });
  } catch (error: any) {
    console.error('Error processing sync queue:', error);
    return res.status(500).json({
      error: 'Failed to process sync queue',
      message: error.message,
    });
  }
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

function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey.padEnd(32).slice(0, 32)), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
