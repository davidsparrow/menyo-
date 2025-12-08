import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';

// Simple encryption/decryption (in production, use a more secure method)
function encrypt(text: string): string {
  const cipher = crypto.createCipher('aes-256-cbc', encryptionKey);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decrypt(encrypted: string): string {
  const decipher = crypto.createDecipher('aes-256-cbc', encryptionKey);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Get auth token from request
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Verify user
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Get user's tenant_id
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

  const { id } = req.query;
  const { key_type } = req.body;

  if (req.method === 'GET') {
    const { masked } = req.query;
    
    // Get API key
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('key_type', key_type || 'gemini')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'API key not found' });
    }

    try {
      const decryptedKey = decrypt(data.encrypted_key);
      
      // If masked=true, return masked version (for UI display)
      if (masked === 'true') {
        return res.status(200).json({ 
          key_type: data.key_type,
          key: decryptedKey.substring(0, 4) + '••••••••' + decryptedKey.substring(decryptedKey.length - 4)
        });
      }
      
      // Otherwise return full key (for API usage - still requires auth)
      return res.status(200).json({ 
        key_type: data.key_type,
        key: decryptedKey
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to decrypt key' });
    }
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    // Store API key (encrypted)
    const { api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({ error: 'api_key is required' });
    }

    if (!key_type) {
      return res.status(400).json({ error: 'key_type is required' });
    }

    const encryptedKey = encrypt(api_key);

    const { data, error } = await supabase
      .from('api_keys')
      .upsert({
        tenant_id: tenantId,
        key_type,
        encrypted_key: encryptedKey,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id,key_type'
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ 
      success: true,
      key_type: data.key_type 
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

