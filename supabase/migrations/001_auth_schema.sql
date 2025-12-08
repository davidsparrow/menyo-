-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
CREATE TYPE user_role AS ENUM ('super-admin', 'admin', 'user');
CREATE TYPE plan_type AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  tenant_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan plan_type NOT NULL DEFAULT 'FREE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add foreign key constraint for users.tenant_id
ALTER TABLE users ADD CONSTRAINT fk_users_tenant 
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

-- User profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  plan plan_type NOT NULL DEFAULT 'FREE',
  profile_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role_val user_role;
  tenant_id_val UUID;
  is_super_admin BOOLEAN;
BEGIN
  -- Check if user is super-admin (from environment variable or email check)
  -- For now, we'll check a specific email pattern or use a config table
  -- In production, this should check against an env var or config
  is_super_admin := NEW.email = COALESCE(current_setting('app.super_admin_email', true), '');
  
  IF is_super_admin THEN
    user_role_val := 'super-admin';
    tenant_id_val := NULL;
  ELSE
    -- For new users, create a tenant if they're the first user
    -- Otherwise, they'll be assigned to a tenant via invitation
    user_role_val := 'admin'; -- First user becomes admin of their tenant
    tenant_id_val := NULL; -- Will be set after tenant creation
  END IF;

  -- Insert into users table
  INSERT INTO public.users (id, email, role, tenant_id)
  VALUES (NEW.id, NEW.email, user_role_val, tenant_id_val)
  ON CONFLICT (id) DO NOTHING;

  -- If not super-admin, create tenant and user profile
  IF NOT is_super_admin THEN
    -- Create tenant
    INSERT INTO public.tenants (name, owner_id, plan)
    VALUES (split_part(NEW.email, '@', 1) || '''s Restaurant', NEW.id, 'FREE')
    RETURNING id INTO tenant_id_val;

    -- Update user with tenant_id
    UPDATE public.users SET tenant_id = tenant_id_val WHERE id = NEW.id;

    -- Create user profile
    INSERT INTO public.user_profiles (user_id, tenant_id, plan)
    VALUES (NEW.id, tenant_id_val, 'FREE')
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    -- For super-admin, create profile without tenant
    INSERT INTO public.user_profiles (user_id, tenant_id, plan)
    VALUES (NEW.id, NULL, 'FREE')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically handle new user signups
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users can read own data" ON users
  FOR SELECT USING (auth.uid() = id);

-- Super-admins can read all users
CREATE POLICY "Super-admins can read all users" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super-admin'
    )
  );

-- Users can read their tenant's data
CREATE POLICY "Users can read tenant users" ON users
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Tenants policies
CREATE POLICY "Users can read own tenant" ON tenants
  FOR SELECT USING (
    owner_id = auth.uid() OR 
    id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Super-admins can read all tenants
CREATE POLICY "Super-admins can read all tenants" ON tenants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super-admin'
    )
  );

-- User profiles policies
CREATE POLICY "Users can read own profile" ON user_profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can read tenant profiles" ON user_profiles
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  );

-- Super-admins can read all profiles
CREATE POLICY "Super-admins can read all profiles" ON user_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super-admin'
    )
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_id ON tenants(owner_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant_id ON user_profiles(tenant_id);

