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
    // Get access token by refreshing
    const service = new GoogleCalendarService('', refreshToken, googleClientId, googleClientSecret);
    const accessToken = await service.refreshAccessToken();
    return { accessToken, refreshToken };
  } catch (err) {
    console.error('Error getting Google Calendar tokens:', err);
    return null;
  }
}

/**
 * List user's calendars
 * GET /api/google-calendar/calendars
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

  if (req.method === 'GET') {
    try {
      const tokens = await getGoogleCalendarTokens(tenantId!);
      if (!tokens) {
        return res.status(404).json({ error: 'Google Calendar not connected. Please connect your Google Calendar account.' });
      }

      const service = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken, googleClientId, googleClientSecret);
      const calendars = await service.getCalendars();

      return res.status(200).json({ calendars });
    } catch (error: any) {
      console.error('Error fetching calendars:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to fetch calendars' 
      });
    }
  }

  if (req.method === 'POST') {
    // Store selected calendar ID in restaurant profile
    try {
      const { calendar_id } = req.body;
      if (!calendar_id) {
        return res.status(400).json({ error: 'calendar_id is required' });
      }

      // Get restaurant for this tenant
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id, profile_data')
        .eq('tenant_id', tenantId)
        .single();

      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      // Update profile_data with selected calendar
      const profileData = (restaurant.profile_data as any) || {};
      profileData.googleCalendarId = calendar_id;

      const { error: updateError } = await supabase
        .from('restaurants')
        .update({ profile_data: profileData })
        .eq('id', restaurant.id);

      if (updateError) {
        return res.status(500).json({ error: 'Failed to save calendar selection' });
      }

      return res.status(200).json({ success: true, calendar_id });
    } catch (error: any) {
      console.error('Error saving calendar selection:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to save calendar selection' 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
