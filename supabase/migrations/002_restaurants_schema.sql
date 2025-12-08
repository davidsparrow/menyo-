-- Restaurants table (stores restaurant profiles)
CREATE TABLE IF NOT EXISTS restaurants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- API Keys table (encrypted storage for tenant API keys)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_type TEXT NOT NULL, -- 'gemini', 'gloria_foods', 'twilio', etc.
  encrypted_key TEXT NOT NULL, -- Encrypted API key
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, key_type)
);

-- Reservations table
CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  party_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('CONFIRMED', 'PENDING', 'CANCELLED')),
  phone TEXT,
  notes TEXT,
  table_ids TEXT[], -- Array of table IDs
  has_conflict BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add updated_at trigger for restaurants
CREATE TRIGGER update_restaurants_updated_at BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add updated_at trigger for api_keys
CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add updated_at trigger for reservations
CREATE TRIGGER update_reservations_updated_at BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- Restaurants policies
CREATE POLICY "Users can read own restaurant" ON restaurants
  FOR SELECT USING (
    user_id = auth.uid() OR
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update own restaurant" ON restaurants
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can insert own restaurant" ON restaurants
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Super-admins can read all restaurants
CREATE POLICY "Super-admins can read all restaurants" ON restaurants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super-admin'
    )
  );

-- API Keys policies
CREATE POLICY "Users can read own tenant api keys" ON api_keys
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update own tenant api keys" ON api_keys
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'super-admin')
    )
  );

CREATE POLICY "Users can insert own tenant api keys" ON api_keys
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'super-admin')
    )
  );

-- Reservations policies
CREATE POLICY "Users can read own tenant reservations" ON reservations
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update own tenant reservations" ON reservations
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can insert own tenant reservations" ON reservations
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_restaurants_tenant_id ON restaurants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_user_id ON restaurants(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_restaurant_id ON reservations(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_id ON reservations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date);

