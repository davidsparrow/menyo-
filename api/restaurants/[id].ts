import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

  const { id } = req.query;

  if (req.method === 'GET') {
    // Get restaurant profile
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    // Verify user has access to this restaurant
    const { data: userData } = await supabase
      .from('users')
      .select('role, tenant_id')
      .eq('id', user.id)
      .single();

    if (userData?.role !== 'super-admin' && data.tenant_id !== userData?.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    // Update restaurant profile
    const { profile_data } = req.body;

    if (!profile_data) {
      return res.status(400).json({ error: 'profile_data is required' });
    }

    // Get user's tenant_id
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    const { data, error } = await supabase
      .from('restaurants')
      .update({
        profile_data,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('user_id', user.id) // Ensure user owns this restaurant
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

