import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createGloriaFoodsService } from '../../../services/gloriaFoodsService';

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

async function getGloriaFoodsToken(tenantId: string): Promise<string | null> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('encrypted_key')
    .eq('tenant_id', tenantId)
    .eq('key_type', 'gloria_foods')
    .single();

  if (error || !data) {
    return null;
  }

  try {
    return decrypt(data.encrypted_key);
  } catch (err) {
    console.error('Error decrypting Gloria Foods token:', err);
    return null;
  }
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

  if (req.method === 'GET') {
    try {
      // Get Gloria Foods token
      const gloriaToken = await getGloriaFoodsToken(tenantId!);
      if (!gloriaToken) {
        return res.status(404).json({ error: 'Gloria Foods not connected. Please connect your Gloria Foods account in Settings.' });
      }

      // Create service instance
      const gloriaService = createGloriaFoodsService(gloriaToken);
      
      // Fetch menu
      const menu = await gloriaService.fetchMenu();
      
      // Also get menu context for AI
      const menuContext = await gloriaService.getMenuContext();

      return res.status(200).json({
        menu,
        menuContext,
      });
    } catch (error: any) {
      console.error('Error fetching Gloria Foods menu:', error);
      return res.status(500).json({ 
        error: error.message || 'Failed to fetch menu from Gloria Foods' 
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

