import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { GoogleCalendarService } from '../../../services/googleCalendarService';
import { syncReservationToGoogleCalendar, syncGoogleEventToReservation } from '../../../lib/calendarSync';

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
 * Process sync queue - retry failed operations
 * This endpoint should be called periodically (every minute) via Vercel Cron Jobs
 * GET /api/google-calendar/process-sync-queue?cron_secret=xxx
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional: Add cron secret for security
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.query.cron_secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get pending operations ready for retry
    const { data: pendingOps, error: queueError } = await supabase
      .from('sync_queue')
      .select('*')
      .eq('status', 'PENDING')
      .lte('next_retry_at', new Date().toISOString())
      .lt('retry_count', 5) // Don't process if max retries reached
      .order('created_at', { ascending: true })
      .limit(50); // Process up to 50 at a time

    if (queueError) {
      throw new Error(`Failed to query sync queue: ${queueError.message}`);
    }

    if (!pendingOps || pendingOps.length === 0) {
      return res.status(200).json({
        success: true,
        processed: 0,
        message: 'No operations to process',
      });
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const op of pendingOps) {
      try {
        // Mark as processing
        await supabase
          .from('sync_queue')
          .update({ status: 'PROCESSING' })
          .eq('id', op.id);

        // Process based on operation type
        switch (op.operation_type) {
          case 'create_event':
          case 'update_event': {
            await syncReservationToGoogleCalendar(
              op.payload.reservation_id,
              op.restaurant_id,
              op.tenant_id
            );
            break;
          }
          case 'sync_from_google': {
            // Get calendar ID from watch
            const { data: watch } = await supabase
              .from('google_calendar_watches')
              .select('calendar_id')
              .eq('restaurant_id', op.restaurant_id)
              .single();

            if (watch) {
              await syncGoogleEventToReservation(
                watch.calendar_id,
                op.payload.event_id,
                op.restaurant_id,
                op.tenant_id,
                op.payload.change_type || 'updated'
              );
            }
            break;
          }
          case 'delete_event': {
            const tokens = await getGoogleCalendarTokens(op.tenant_id);
            if (tokens) {
              const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);
              await calendarService.deleteEvent(
                op.payload.calendar_id,
                op.payload.event_id
              );
            }
            break;
          }
        }

        // Mark as completed
        await supabase
          .from('sync_queue')
          .update({ 
            status: 'COMPLETED',
            updated_at: new Date().toISOString(),
          })
          .eq('id', op.id);

        succeeded++;
      } catch (error: any) {
        // Calculate next retry with exponential backoff
        const retryCount = op.retry_count + 1;
        const backoffMinutes = Math.min(Math.pow(2, retryCount), 16); // 1, 2, 4, 8, 16 minutes
        const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

        if (retryCount >= op.max_retries) {
          // Mark as failed after max retries
          await supabase
            .from('sync_queue')
            .update({
              status: 'FAILED',
              error_message: error.message,
              updated_at: new Date().toISOString(),
            })
            .eq('id', op.id);
        } else {
          // Queue for retry
          await supabase
            .from('sync_queue')
            .update({
              status: 'PENDING',
              retry_count: retryCount,
              next_retry_at: nextRetryAt.toISOString(),
              error_message: error.message,
              updated_at: new Date().toISOString(),
            })
            .eq('id', op.id);
        }

        failed++;
        console.error(`Failed to process sync operation ${op.id}:`, error);
      }

      processed++;
    }

    return res.status(200).json({
      success: true,
      processed,
      succeeded,
      failed,
      message: `Processed ${processed} operations: ${succeeded} succeeded, ${failed} failed`,
    });
  } catch (error: any) {
    console.error('Error processing sync queue:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process sync queue',
    });
  }
}
