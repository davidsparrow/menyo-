import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
const googleClientId = process.env.GOOGLE_CLIENT_ID!;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET!;

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey.padEnd(32).slice(0, 32)), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * OAuth2 callback handler for Google Calendar
 * GET /api/google-calendar/auth?code=xxx&state=xxx
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?error=${encodeURIComponent(error as string)}`);
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    // Decode state to get tenant_id
    const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
    const { tenant_id } = stateData;

    if (!tenant_id) {
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code as string,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/google-calendar/auth`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      throw new Error(error.error_description || 'Failed to exchange code for tokens');
    }

    const tokens = await tokenResponse.json();

    // Encrypt and store tokens
    const tokensJson = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    const encryptedTokens = encrypt(tokensJson);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Store in api_keys table
    await supabase
      .from('api_keys')
      .upsert({
        tenant_id,
        key_type: 'google_calendar',
        encrypted_key: encryptedTokens,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,key_type',
      });

    // Update restaurant profile to enable Google Calendar integration
    const { data: restaurants } = await supabase
      .from('restaurants')
      .select('id, profile_data')
      .eq('tenant_id', tenant_id);

    if (restaurants && restaurants.length > 0) {
      for (const restaurant of restaurants) {
        const profileData = (restaurant.profile_data as any) || {};
        profileData.integrations = profileData.integrations || {};
        profileData.integrations.googleCalendar = true;

        await supabase
          .from('restaurants')
          .update({ profile_data: profileData })
          .eq('id', restaurant.id);
      }
    }

    // Redirect back to app with success
    // The profile will be updated automatically via the restaurants table update above
    return res.redirect('/?google_calendar_connected=true&step=4');
  } catch (error: any) {
    console.error('Error in Google Calendar OAuth callback:', error);
    return res.redirect(`/?error=${encodeURIComponent(error.message || 'Failed to connect Google Calendar')}`);
  }
}
