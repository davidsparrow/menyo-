import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { GoogleCalendarService } from '../../../services/googleCalendarService';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';

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
 * Set up or stop watch channels for Google Calendar push notifications
 * POST /api/google-calendar/watch - Create watch channel
 * DELETE /api/google-calendar/watch - Stop watch channel
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

  if (req.method === 'POST') {
    try {
      const { restaurant_id, calendar_id } = req.body;

      if (!restaurant_id || !calendar_id) {
        return res.status(400).json({ error: 'restaurant_id and calendar_id are required' });
      }

      // Get tokens
      const tokens = await getGoogleCalendarTokens(tenantId!);
      if (!tokens) {
        return res.status(404).json({ error: 'Google Calendar not connected' });
      }

      // Check if watch already exists
      const { data: existingWatch } = await supabase
        .from('google_calendar_watches')
        .select('*')
        .eq('restaurant_id', restaurant_id)
        .eq('calendar_id', calendar_id)
        .single();

      // If exists and not expired, return existing
      if (existingWatch && new Date(existingWatch.expiration) > new Date()) {
        return res.status(200).json({
          success: true,
          watch: existingWatch,
          message: 'Watch channel already exists',
        });
      }

      // Stop existing watch if expired
      if (existingWatch) {
        const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);
        try {
          await calendarService.stopWatch(existingWatch.channel_id, existingWatch.resource_id || '');
        } catch (err) {
          console.warn('Error stopping expired watch:', err);
        }
      }

      // Generate channel ID and token
      const channelId = `menyo_${restaurant_id}_${Date.now()}`;
      const channelToken = generateChannelToken();

      // Calculate expiration (max 7 days = 604800 seconds)
      const expirationSeconds = 604800; // 7 days
      const expiration = new Date(Date.now() + expirationSeconds * 1000);

      // Webhook URL (use request origin)
      const webhookUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/google-calendar/webhook`;

      // Create watch channel
      const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);
      const watchResponse = await calendarService.watchEvents(calendar_id, {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token: channelToken,
        expiration: expiration.getTime(),
      });

      // Store watch in database
      const { data: watch, error: insertError } = await supabase
        .from('google_calendar_watches')
        .upsert({
          restaurant_id,
          tenant_id: tenantId,
          calendar_id,
          channel_id: channelId,
          resource_id: watchResponse.resourceId,
          channel_token: channelToken,
          expiration: expiration.toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'restaurant_id,calendar_id',
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Failed to store watch: ${insertError.message}`);
      }

      return res.status(200).json({
        success: true,
        watch: {
          channel_id: channelId,
          resource_id: watchResponse.resourceId,
          expiration: expiration.toISOString(),
        },
        message: 'Watch channel created successfully',
      });
    } catch (error: any) {
      console.error('Error creating watch:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to create watch channel' 
      });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { restaurant_id, calendar_id } = req.query;

      if (!restaurant_id || !calendar_id) {
        return res.status(400).json({ error: 'restaurant_id and calendar_id are required' });
      }

      // Get watch record
      const { data: watch } = await supabase
        .from('google_calendar_watches')
        .select('*')
        .eq('restaurant_id', restaurant_id)
        .eq('calendar_id', calendar_id)
        .single();

      if (!watch) {
        return res.status(404).json({ error: 'Watch channel not found' });
      }

      // Get tokens
      const tokens = await getGoogleCalendarTokens(tenantId!);
      if (!tokens) {
        return res.status(404).json({ error: 'Google Calendar not connected' });
      }

      // Stop watch
      const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);
      await calendarService.stopWatch(watch.channel_id, watch.resource_id || '');

      // Delete from database
      await supabase
        .from('google_calendar_watches')
        .delete()
        .eq('id', watch.id);

      return res.status(200).json({
        success: true,
        message: 'Watch channel stopped successfully',
      });
    } catch (error: any) {
      console.error('Error stopping watch:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to stop watch channel' 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
