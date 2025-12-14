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
 * Exchanges authorization code for access and refresh tokens
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state, error } = req.query;

  // Handle OAuth errors
  if (error) {
    return res.redirect(`/?error=${encodeURIComponent(error as string)}&source=google_calendar`);
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  // Verify state contains tenant_id (for security)
  if (!state || typeof state !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid state parameter' });
  }

  try {
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
      return res.redirect(`/?error=${encodeURIComponent(error.error || 'Failed to exchange code for tokens')}&source=google_calendar`);
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokens;

    if (!refresh_token) {
      return res.redirect(`/?error=${encodeURIComponent('No refresh token received. Please ensure you granted offline access.')}&source=google_calendar`);
    }

    // Parse state to get tenant_id
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    const { tenant_id } = stateData;

    if (!tenant_id) {
      return res.status(400).json({ error: 'Missing tenant_id in state' });
    }

    // Store refresh token encrypted in api_keys table
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const encryptedRefreshToken = encrypt(refresh_token);

    const { error: upsertError } = await supabase
      .from('api_keys')
      .upsert({
        tenant_id,
        key_type: 'google_calendar',
        encrypted_key: encryptedRefreshToken,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'tenant_id,key_type',
      });

    if (upsertError) {
      console.error('Error storing refresh token:', upsertError);
      return res.redirect(`/?error=${encodeURIComponent('Failed to store credentials')}&source=google_calendar`);
    }

    // Redirect back to app with success
    return res.redirect(`/?google_calendar_connected=true`);
  } catch (error: any) {
    console.error('Error in Google Calendar OAuth callback:', error);
    return res.redirect(`/?error=${encodeURIComponent(error.message || 'OAuth callback failed')}&source=google_calendar`);
  }
}
