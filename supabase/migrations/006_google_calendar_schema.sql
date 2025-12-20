-- Google Calendar Integration Schema
-- Adds support for two-way sync with Google Calendar and webhook subscriptions

-- Add columns to reservations table for Google Calendar sync
ALTER TABLE reservations 
  ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT, -- Link to Google Calendar event
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ, -- Last successful sync timestamp
  ADD COLUMN IF NOT EXISTS last_modified_source TEXT CHECK (last_modified_source IN ('LOCAL', 'GOOGLE_CALENDAR', 'GLORIA_FOODS')); -- Source of last modification

-- Index for Google Calendar event lookups
CREATE INDEX IF NOT EXISTS idx_reservations_google_event_id 
  ON reservations(google_calendar_event_id) 
  WHERE google_calendar_event_id IS NOT NULL;

-- Google Calendar Watch Channels table
-- Stores active push notification channels for Google Calendar
CREATE TABLE IF NOT EXISTS google_calendar_watches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL, -- Google Calendar ID (e.g., 'primary' or full email)
  channel_id TEXT NOT NULL UNIQUE, -- Google channel ID (unique per watch)
  resource_id TEXT, -- Google resource ID (returned by watch API)
  channel_token TEXT NOT NULL, -- Security token for webhook validation (32+ char random)
  expiration TIMESTAMPTZ NOT NULL, -- When watch expires (max 604800 seconds = 7 days)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook Subscriptions table
-- Stores Make.com/n8n webhook URLs for automation triggers
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_url TEXT NOT NULL,
  event_types TEXT[] NOT NULL, -- ['reservation.created', 'reservation.updated', 'reservation.cancelled']
  secret_token TEXT NOT NULL, -- For webhook authentication (sent as Authorization: Bearer token)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sync Queue table (for retry mechanism)
-- Queues failed sync operations for retry with exponential backoff
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
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add updated_at triggers
CREATE TRIGGER update_google_calendar_watches_updated_at BEFORE UPDATE ON google_calendar_watches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhook_subscriptions_updated_at BEFORE UPDATE ON webhook_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sync_queue_updated_at BEFORE UPDATE ON sync_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
ALTER TABLE google_calendar_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;

-- Google Calendar Watches policies
CREATE POLICY "Users can read own tenant google_calendar_watches" ON google_calendar_watches
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage own tenant google_calendar_watches" ON google_calendar_watches
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Webhook Subscriptions policies
CREATE POLICY "Users can read own tenant webhook_subscriptions" ON webhook_subscriptions
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage own tenant webhook_subscriptions" ON webhook_subscriptions
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Sync Queue policies
CREATE POLICY "Users can read own tenant sync_queue" ON sync_queue
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage own tenant sync_queue" ON sync_queue
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Super-admins can read all
CREATE POLICY "Super-admins can read all google_calendar_watches" ON google_calendar_watches
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super-admin')
  );

CREATE POLICY "Super-admins can read all webhook_subscriptions" ON webhook_subscriptions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super-admin')
  );

CREATE POLICY "Super-admins can read all sync_queue" ON sync_queue
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super-admin')
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_google_calendar_watches_restaurant_id ON google_calendar_watches(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_watches_tenant_id ON google_calendar_watches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_watches_expiration ON google_calendar_watches(expiration);
CREATE INDEX IF NOT EXISTS idx_google_calendar_watches_resource_id ON google_calendar_watches(resource_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_watches_channel_id ON google_calendar_watches(channel_id);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_restaurant_id ON webhook_subscriptions(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant_id ON webhook_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_active ON webhook_subscriptions(is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_sync_queue_next_retry ON sync_queue(next_retry_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_sync_queue_restaurant_id ON sync_queue(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_tenant_id ON sync_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
