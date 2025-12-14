-- Google Calendar Integration Schema
-- Adds support for two-way sync with Google Calendar

-- Add columns to reservations table
ALTER TABLE reservations 
  ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_source TEXT CHECK (last_modified_source IN ('LOCAL', 'GOOGLE_CALENDAR', 'GLORIA_FOODS'));

-- Index for Google Calendar event ID lookups
CREATE INDEX IF NOT EXISTS idx_reservations_google_event_id 
  ON reservations(google_calendar_event_id) 
  WHERE google_calendar_event_id IS NOT NULL;

-- Webhook subscriptions table (for Make.com/n8n)
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_url TEXT NOT NULL,
  event_types TEXT[] NOT NULL, -- ['reservation.created', 'reservation.updated', 'reservation.cancelled']
  secret_token TEXT NOT NULL, -- For webhook authentication (sent as Authorization header)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync queue table (for retry mechanism)
CREATE TABLE IF NOT EXISTS sync_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL, -- 'create_event', 'update_event', 'delete_event', 'sync_from_google'
  payload JSONB NOT NULL, -- Operation-specific data
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 5,
  next_retry_at TIMESTAMPTZ NOT NULL, -- Calculated with exponential backoff
  error_message TEXT,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Google Calendar watches table
CREATE TABLE IF NOT EXISTS google_calendar_watches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL, -- Google Calendar ID
  channel_id TEXT NOT NULL UNIQUE, -- Google channel ID (unique per watch)
  resource_id TEXT, -- Google resource ID (returned by watch API)
  channel_token TEXT NOT NULL, -- Security token for webhook validation (32+ char random)
  expiration TIMESTAMPTZ NOT NULL, -- When watch expires (max 604800 seconds = 7 days)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_watches_expiration ON google_calendar_watches(expiration);
CREATE INDEX IF NOT EXISTS idx_watches_resource_id ON google_calendar_watches(resource_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_next_retry ON sync_queue(next_retry_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_sync_queue_restaurant ON sync_queue(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_restaurant ON webhook_subscriptions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant ON webhook_subscriptions(tenant_id);

-- Add updated_at triggers
CREATE TRIGGER update_webhook_subscriptions_updated_at BEFORE UPDATE ON webhook_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sync_queue_updated_at BEFORE UPDATE ON sync_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_google_calendar_watches_updated_at BEFORE UPDATE ON google_calendar_watches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_watches ENABLE ROW LEVEL SECURITY;

-- Webhook subscriptions policies
CREATE POLICY "Users can read own tenant webhook subscriptions" ON webhook_subscriptions
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage own tenant webhook subscriptions" ON webhook_subscriptions
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Sync queue policies
CREATE POLICY "Users can read own tenant sync queue" ON sync_queue
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage own tenant sync queue" ON sync_queue
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Google Calendar watches policies
CREATE POLICY "Users can read own tenant google calendar watches" ON google_calendar_watches
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage own tenant google calendar watches" ON google_calendar_watches
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );
