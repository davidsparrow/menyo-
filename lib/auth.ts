import { supabase } from './supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { UserRole } from '../types';

export interface AuthUser extends User {
  role?: UserRole;
  tenant_id?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  session: Session | null;
}

// Get current authenticated user with metadata
export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  // Fetch user metadata from our users table
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  if (userError) {
    console.error('Error fetching user metadata:', userError);
    return { ...user, role: 'user' as UserRole, tenant_id: null };
  }

  return {
    ...user,
    role: userData?.role as UserRole || 'user',
    tenant_id: userData?.tenant_id || null
  };
}

// Sign up new user
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  return { data, error };
}

// Sign in existing user
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

// Get current session
export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  return { session, error };
}

// Listen to auth state changes
export function onAuthStateChange(callback: (event: string, session: Session | null) => void) {
  return supabase.auth.onAuthStateChange(callback);
}

