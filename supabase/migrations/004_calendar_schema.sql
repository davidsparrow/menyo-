-- Enhanced Calendar Schema for Restaurant Table Management
-- Aligned with Gloria Foods calendar model and restaurant best practices
-- Supports table assignments, capacity tracking, and time slot management

-- Tables table (physical restaurant tables)
-- Currently stored in profile_data JSONB, but needs proper relational structure
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_number INTEGER NOT NULL,
  name TEXT NOT NULL, -- e.g., "Window Booth A", "Center Table 1"
  max_guests INTEGER NOT NULL,
  min_guests INTEGER DEFAULT 1, -- Minimum party size for this table
  location TEXT, -- e.g., "Indoor", "Patio", "Window", "Private Room"
  features TEXT[], -- e.g., ["wheelchair_accessible", "high_chair", "outdoor"]
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id, table_number)
);

-- Enhanced Reservations table
-- Extends existing reservations with calendar-specific fields
ALTER TABLE reservations 
  ADD COLUMN IF NOT EXISTS gloria_foods_reservation_id TEXT, -- External ID from Gloria Foods
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS reservation_datetime TIMESTAMPTZ, -- Combined date+time for easier querying
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 120, -- Default 2 hours, configurable
  ADD COLUMN IF NOT EXISTS end_datetime TIMESTAMPTZ, -- Calculated: reservation_datetime + duration
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'LOCAL' CHECK (source IN ('LOCAL', 'GLORIA_FOODS', 'GOOGLE_CALENDAR', 'PHONE', 'WALK_IN')),
  ADD COLUMN IF NOT EXISTS special_requests TEXT, -- Dietary restrictions, accessibility needs, etc.
  ADD COLUMN IF NOT EXISTS customer_notes TEXT, -- Customer's special notes
  ADD COLUMN IF NOT EXISTS internal_notes TEXT, -- Staff notes (not visible to customer)
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS no_show BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;

-- Reservation-Tables junction table (many-to-many)
-- A reservation can use multiple tables (for large parties)
CREATE TABLE IF NOT EXISTS reservation_tables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(reservation_id, table_id)
);

-- Time slot capacity tracking (for quick availability checks)
-- Pre-calculated capacity per time slot to avoid expensive queries
CREATE TABLE IF NOT EXISTS time_slot_capacity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL, -- Start time of slot (e.g., 18:00 for 6pm slot)
  slot_duration_minutes INTEGER DEFAULT 30, -- Slot granularity (30-min or 60-min blocks)
  total_capacity INTEGER NOT NULL, -- Max guests per hour from restaurant settings
  reserved_guests INTEGER DEFAULT 0, -- Sum of party_size for all reservations in this slot
  available_capacity INTEGER GENERATED ALWAYS AS (total_capacity - reserved_guests) STORED,
  table_count INTEGER DEFAULT 0, -- Number of tables available in this slot
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id, slot_date, slot_time, slot_duration_minutes)
);

-- Function to calculate end_datetime from reservation_datetime + duration
CREATE OR REPLACE FUNCTION calculate_reservation_end_time()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reservation_datetime IS NOT NULL AND NEW.duration_minutes IS NOT NULL THEN
    NEW.end_datetime := NEW.reservation_datetime + (NEW.duration_minutes || ' minutes')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate end_datetime
CREATE TRIGGER calculate_reservation_end_time_trigger
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION calculate_reservation_end_time();

-- Function to update time slot capacity when reservation changes
CREATE OR REPLACE FUNCTION update_time_slot_capacity()
RETURNS TRIGGER AS $$
DECLARE
  slot_date DATE;
  slot_time TIME;
  slot_duration INTEGER := 30; -- Default 30-minute slots
  restaurant_uuid UUID;
  tenant_uuid UUID;
  total_guests INTEGER;
BEGIN
  -- Get restaurant and tenant IDs
  SELECT restaurant_id, tenant_id INTO restaurant_uuid, tenant_uuid
  FROM reservations WHERE id = COALESCE(NEW.id, OLD.id);
  
  -- Handle INSERT or UPDATE
  IF TG_OP = 'INSERT' THEN
    slot_date := DATE(NEW.reservation_datetime);
    slot_time := DATE_TRUNC('hour', NEW.reservation_datetime::TIME) + 
                 (FLOOR(EXTRACT(MINUTE FROM NEW.reservation_datetime) / slot_duration) * slot_duration || ' minutes')::INTERVAL;
    total_guests := NEW.party_size;
  ELSIF TG_OP = 'UPDATE' THEN
    -- If reservation was cancelled or deleted, subtract old guests
    IF NEW.status = 'CANCELLED' OR OLD.status != 'CANCELLED' THEN
      slot_date := DATE(OLD.reservation_datetime);
      slot_time := DATE_TRUNC('hour', OLD.reservation_datetime::TIME) + 
                   (FLOOR(EXTRACT(MINUTE FROM OLD.reservation_datetime) / slot_duration) * slot_duration || ' minutes')::INTERVAL;
      total_guests := -OLD.party_size;
    ELSE
      -- Update: subtract old, add new
      slot_date := DATE(NEW.reservation_datetime);
      slot_time := DATE_TRUNC('hour', NEW.reservation_datetime::TIME) + 
                   (FLOOR(EXTRACT(MINUTE FROM NEW.reservation_datetime) / slot_duration) * slot_duration || ' minutes')::INTERVAL;
      total_guests := NEW.party_size - COALESCE(OLD.party_size, 0);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    slot_date := DATE(OLD.reservation_datetime);
    slot_time := DATE_TRUNC('hour', OLD.reservation_datetime::TIME) + 
                 (FLOOR(EXTRACT(MINUTE FROM OLD.reservation_datetime) / slot_duration) * slot_duration || ' minutes')::INTERVAL;
    total_guests := -OLD.party_size;
  END IF;
  
  -- Update or insert time slot capacity
  INSERT INTO time_slot_capacity (
    restaurant_id, tenant_id, slot_date, slot_time, slot_duration_minutes, 
    total_capacity, reserved_guests
  )
  SELECT 
    restaurant_uuid, tenant_uuid, slot_date, slot_time, slot_duration,
    COALESCE((SELECT max_guests_per_hour FROM restaurants r 
              JOIN user_profiles up ON r.user_id = up.user_id 
              WHERE r.id = restaurant_uuid), 50), -- Default 50 if not set
    COALESCE((
      SELECT SUM(party_size) 
      FROM reservations 
      WHERE restaurant_id = restaurant_uuid
        AND DATE(reservation_datetime) = slot_date
        AND reservation_datetime::TIME >= slot_time
        AND reservation_datetime::TIME < slot_time + (slot_duration || ' minutes')::INTERVAL
        AND status != 'CANCELLED'
    ), 0)
  ON CONFLICT (restaurant_id, slot_date, slot_time, slot_duration_minutes)
  DO UPDATE SET
    reserved_guests = time_slot_capacity.reserved_guests + total_guests,
    updated_at = NOW();
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger to update capacity when reservation changes
CREATE TRIGGER update_time_slot_capacity_trigger
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION update_time_slot_capacity();

-- Add updated_at trigger for tables
CREATE TRIGGER update_tables_updated_at BEFORE UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add updated_at trigger for time_slot_capacity
CREATE TRIGGER update_time_slot_capacity_updated_at BEFORE UPDATE ON time_slot_capacity
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slot_capacity ENABLE ROW LEVEL SECURITY;

-- Tables policies
CREATE POLICY "Users can read own tenant tables" ON tables
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update own tenant tables" ON tables
  FOR UPDATE USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can insert own tenant tables" ON tables
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Reservation tables policies
CREATE POLICY "Users can read own tenant reservation_tables" ON reservation_tables
  FOR SELECT USING (
    reservation_id IN (
      SELECT id FROM reservations 
      WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can manage own tenant reservation_tables" ON reservation_tables
  FOR ALL USING (
    reservation_id IN (
      SELECT id FROM reservations 
      WHERE tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
    )
  );

-- Time slot capacity policies
CREATE POLICY "Users can read own tenant time_slot_capacity" ON time_slot_capacity
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tables_restaurant_id ON tables(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_tables_tenant_id ON tables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_datetime ON reservations(reservation_datetime);
CREATE INDEX IF NOT EXISTS idx_reservations_end_datetime ON reservations(end_datetime);
CREATE INDEX IF NOT EXISTS idx_reservations_gloria_foods_id ON reservations(gloria_foods_reservation_id) WHERE gloria_foods_reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_source ON reservations(source);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservation_tables_reservation_id ON reservation_tables(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_tables_table_id ON reservation_tables(table_id);
CREATE INDEX IF NOT EXISTS idx_time_slot_capacity_restaurant_date ON time_slot_capacity(restaurant_id, slot_date, slot_time);
CREATE INDEX IF NOT EXISTS idx_time_slot_capacity_tenant_id ON time_slot_capacity(tenant_id);

-- Composite index for availability queries (most common query)
CREATE INDEX IF NOT EXISTS idx_time_slot_capacity_availability 
  ON time_slot_capacity(restaurant_id, slot_date, slot_time, available_capacity);

-- Function to check reservation availability
-- Returns available capacity for a given time slot
CREATE OR REPLACE FUNCTION check_reservation_availability(
  p_restaurant_id UUID,
  p_date DATE,
  p_time TIME,
  p_party_size INTEGER,
  p_duration_minutes INTEGER DEFAULT 120
)
RETURNS TABLE (
  is_available BOOLEAN,
  available_capacity INTEGER,
  current_reserved_guests INTEGER,
  total_capacity INTEGER,
  conflicting_reservations INTEGER
) AS $$
DECLARE
  slot_start TIMESTAMPTZ;
  slot_end TIMESTAMPTZ;
BEGIN
  slot_start := (p_date || ' ' || p_time)::TIMESTAMPTZ;
  slot_end := slot_start + (p_duration_minutes || ' minutes')::INTERVAL;
  
  RETURN QUERY
  WITH slot_capacity AS (
    SELECT 
      COALESCE(tsc.total_capacity, 50) as total_cap,
      COALESCE(tsc.reserved_guests, 0) as reserved,
      COALESCE(tsc.available_capacity, 50) as available
    FROM time_slot_capacity tsc
    WHERE tsc.restaurant_id = p_restaurant_id
      AND tsc.slot_date = p_date
      AND tsc.slot_time = DATE_TRUNC('hour', p_time::TIME) + 
          (FLOOR(EXTRACT(MINUTE FROM p_time) / 30) * 30 || ' minutes')::INTERVAL
    LIMIT 1
  ),
  conflicts AS (
    SELECT COUNT(*) as conflict_count
    FROM reservations
    WHERE restaurant_id = p_restaurant_id
      AND status != 'CANCELLED'
      AND reservation_datetime < slot_end
      AND end_datetime > slot_start
  )
  SELECT 
    (sc.available >= p_party_size) as is_available,
    sc.available as available_capacity,
    sc.reserved as current_reserved_guests,
    sc.total_cap as total_capacity,
    COALESCE(c.conflict_count, 0)::INTEGER as conflicting_reservations
  FROM slot_capacity sc
  CROSS JOIN conflicts c;
END;
$$ LANGUAGE plpgsql;
