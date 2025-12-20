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
 * List calendars and select calendar
 * GET /api/google-calendar/calendars - List calendars
 * POST /api/google-calendar/calendars - Select calendar (store calendar_id in profile)
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
      // Get tokens
      const tokens = await getGoogleCalendarTokens(tenantId!);
      if (!tokens) {
        return res.status(404).json({ error: 'Google Calendar not connected' });
      }

      // Create service
      const calendarService = new GoogleCalendarService(tokens.accessToken, tokens.refreshToken);
      
      // List calendars
      const calendars = await calendarService.getCalendars();

      return res.status(200).json({ calendars });
    } catch (error: any) {
      console.error('Error listing calendars:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to list calendars' 
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const { calendar_id } = req.body;

      if (!calendar_id) {
        return res.status(400).json({ error: 'calendar_id is required' });
      }

      // Get restaurant
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id, profile_data')
        .eq('tenant_id', tenantId)
        .single();

      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      // Update profile with selected calendar
      const profileData = (restaurant.profile_data as any) || {};
      profileData.googleCalendarId = calendar_id;

      await supabase
        .from('restaurants')
        .update({ profile_data: profileData })
        .eq('id', restaurant.id);

      return res.status(200).json({ 
        success: true,
        calendar_id,
        message: 'Calendar selected successfully' 
      });
    } catch (error: any) {
      console.error('Error selecting calendar:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to select calendar' 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
