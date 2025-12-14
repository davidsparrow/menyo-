import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { GoogleCalendarService } from '@/services/googleCalendarService';

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
 * Set up or stop watch channels for push notifications
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
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

  // Get restaurant and calendar ID
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('id, profile_data')
    .eq('tenant_id', tenantId)
    .single();

  if (!restaurant) {
    return res.status(404).json({ error: 'Restaurant not found' });
  }

  const profileData = (restaurant.profile_data as any) || {};
  const calendarId = profileData.googleCalendarId || 'primary';

  const tokens = await getGoogleCalendarTokens(tenantId!);
  if (!tokens) {
    return res.status(404).json({ error: 'Google Calendar not connected' });
  }

  const service = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken, googleClientId, googleClientSecret);

  if (req.method === 'POST') {
    // Create watch channel
    try {
      const webhookUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/google-calendar/webhook`;
      const channelId = `menyo-${restaurant.id}-${Date.now()}`;
      const channelToken = generateRandomToken(32);
      const expiration = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days from now

      const watchRequest = {
        id: channelId,
        type: 'web_hook' as const,
        address: webhookUrl,
        token: channelToken,
        expiration: expiration,
      };

      const watchChannel = await service.watchEvents(calendarId, watchRequest);

      // Store watch in database
      const { error: insertError } = await supabase
        .from('google_calendar_watches')
        .insert({
          restaurant_id: restaurant.id,
          tenant_id: tenantId,
          calendar_id: calendarId,
          channel_id: channelId,
          resource_id: watchChannel.resourceId,
          channel_token: channelToken,
          expiration: new Date(watchChannel.expiration).toISOString(),
        });

      if (insertError) {
        console.error('Error storing watch:', insertError);
        // Try to stop the watch we just created
        try {
          await service.stopWatch(channelId, watchChannel.resourceId);
        } catch (stopError) {
          console.error('Error stopping watch after failed insert:', stopError);
        }
        return res.status(500).json({ error: 'Failed to store watch channel' });
      }

      return res.status(200).json({
        success: true,
        channel_id: channelId,
        resource_id: watchChannel.resourceId,
        expiration: watchChannel.expiration,
      });
    } catch (error: any) {
      console.error('Error creating watch:', error);
      return res.status(500).json({ error: error.message || 'Failed to create watch channel' });
    }
  }

  if (req.method === 'DELETE') {
    // Stop watch channel
    try {
      const { channel_id } = req.query;
      if (!channel_id || typeof channel_id !== 'string') {
        return res.status(400).json({ error: 'channel_id query parameter is required' });
      }

      // Get watch from database
      const { data: watch } = await supabase
        .from('google_calendar_watches')
        .select('*')
        .eq('channel_id', channel_id)
        .eq('restaurant_id', restaurant.id)
        .single();

      if (!watch) {
        return res.status(404).json({ error: 'Watch not found' });
      }

      // Stop watch via Google API
      if (watch.resource_id) {
        try {
          await service.stopWatch(watch.channel_id, watch.resource_id);
        } catch (stopError) {
          // Continue even if stop fails (watch may already be expired)
          console.warn('Error stopping watch via API:', stopError);
        }
      }

      // Delete from database
      const { error: deleteError } = await supabase
        .from('google_calendar_watches')
        .delete()
        .eq('id', watch.id);

      if (deleteError) {
        return res.status(500).json({ error: 'Failed to delete watch from database' });
      }

      return res.status(200).json({ success: true });
    } catch (error: any) {
      console.error('Error stopping watch:', error);
      return res.status(500).json({ error: error.message || 'Failed to stop watch channel' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
