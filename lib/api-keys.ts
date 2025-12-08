import { supabase } from './supabase';
import { getCurrentUser } from './auth';

// Get tenant's API key from API route (decrypted server-side)
export async function getTenantApiKey(keyType: string = 'gemini'): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      // Fallback to dev API key if not authenticated
      return process.env.API_KEY || process.env.GEMINI_API_KEY || null;
    }

    const user = await getCurrentUser();
    if (!user || !user.tenant_id) {
      // Fallback to dev API key if no tenant
      return process.env.API_KEY || process.env.GEMINI_API_KEY || null;
    }

    // Fetch decrypted key from API route
    const response = await fetch(`/api/restaurants/current/api-key?key_type=${keyType}`, {
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      // Fallback to dev API key if tenant key not found
      return process.env.API_KEY || process.env.GEMINI_API_KEY || null;
    }

    const result = await response.json();
    return result.key || null;
  } catch (error) {
    console.error('Error fetching API key:', error);
    // Fallback to dev API key on error
    return process.env.API_KEY || process.env.GEMINI_API_KEY || null;
  }
}

// Get masked API key for UI display
export async function getMaskedApiKey(keyType: string = 'gemini'): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const response = await fetch(`/api/restaurants/current/api-key?key_type=${keyType}&masked=true`, {
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) return null;

    const result = await response.json();
    return result.key || null;
  } catch (error) {
    console.error('Error fetching masked API key:', error);
    return null;
  }
}

