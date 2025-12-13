-- Migration: Move table data from profile_data JSONB to tables table
-- This migrates existing table configurations from RestaurantProfile to the new relational tables table
-- Run this AFTER 004_calendar_schema.sql

-- Function to migrate tables from profile_data JSONB to tables table
CREATE OR REPLACE FUNCTION migrate_tables_from_jsonb()
RETURNS TABLE (
  restaurant_id UUID,
  tables_migrated INTEGER,
  errors TEXT
) AS $$
DECLARE
  restaurant_record RECORD;
  table_item JSONB;
  table_count INTEGER;
  error_msg TEXT;
BEGIN
  -- Loop through all restaurants
  FOR restaurant_record IN 
    SELECT 
      r.id as restaurant_id,
      r.tenant_id,
      r.profile_data->'tables' as tables_json
    FROM restaurants r
    WHERE r.profile_data->'tables' IS NOT NULL
      AND jsonb_array_length(r.profile_data->'tables') > 0
  LOOP
    table_count := 0;
    error_msg := NULL;
    
    BEGIN
      -- Extract each table from the JSONB array
      FOR table_item IN 
        SELECT * FROM jsonb_array_elements(restaurant_record.tables_json)
      LOOP
        -- Insert into tables table, converting from legacy format
        INSERT INTO tables (
          restaurant_id,
          tenant_id,
          table_number,
          name,
          max_guests,
          min_guests,
          location,
          features,
          is_active
        )
        VALUES (
          restaurant_record.restaurant_id,
          restaurant_record.tenant_id,
          COALESCE((table_item->>'autoNumber')::INTEGER, 
                   (table_item->>'table_number')::INTEGER,
                   -- If no number, use row number
                   (SELECT COALESCE(MAX(table_number), 0) + 1 
                    FROM tables 
                    WHERE restaurant_id = restaurant_record.restaurant_id)),
          COALESCE(table_item->>'name', 'Table ' || table_count + 1),
          COALESCE((table_item->>'maxGuests')::INTEGER,
                   (table_item->>'max_guests')::INTEGER,
                   4), -- Default to 4 if not specified
          COALESCE((table_item->>'minGuests')::INTEGER,
                   (table_item->>'min_guests')::INTEGER,
                   1), -- Default to 1
          table_item->>'location',
          CASE 
            WHEN table_item->'features' IS NOT NULL 
            THEN ARRAY(SELECT jsonb_array_elements_text(table_item->'features'))
            ELSE NULL
          END,
          COALESCE((table_item->>'is_active')::BOOLEAN, TRUE)
        )
        ON CONFLICT (restaurant_id, table_number) DO NOTHING; -- Skip if already exists
        
        table_count := table_count + 1;
      END LOOP;
      
      -- Return success
      RETURN QUERY SELECT 
        restaurant_record.restaurant_id,
        table_count,
        NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
      -- Return error
      error_msg := SQLERRM;
      RETURN QUERY SELECT 
        restaurant_record.restaurant_id,
        0,
        error_msg;
    END;
  END LOOP;
  
  -- Return for restaurants with no tables (already migrated or never had tables)
  RETURN QUERY SELECT 
    r.id,
    0,
    'No tables to migrate'::TEXT
  FROM restaurants r
  WHERE r.profile_data->'tables' IS NULL
     OR jsonb_array_length(r.profile_data->'tables') = 0;
     
END;
$$ LANGUAGE plpgsql;

-- Run the migration
-- This will migrate all existing tables from profile_data to the tables table
DO $$
DECLARE
  result RECORD;
  total_migrated INTEGER := 0;
  total_errors INTEGER := 0;
BEGIN
  RAISE NOTICE 'Starting table migration from JSONB to tables table...';
  
  FOR result IN SELECT * FROM migrate_tables_from_jsonb() LOOP
    IF result.errors IS NULL THEN
      total_migrated := total_migrated + result.tables_migrated;
      RAISE NOTICE 'Restaurant %: Migrated % tables', result.restaurant_id, result.tables_migrated;
    ELSE
      total_errors := total_errors + 1;
      RAISE WARNING 'Restaurant %: Error - %', result.restaurant_id, result.errors;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Migration complete. Total tables migrated: %, Errors: %', total_migrated, total_errors;
END $$;

-- Optional: Create a view to help verify migration
CREATE OR REPLACE VIEW migration_verification AS
SELECT 
  r.id as restaurant_id,
  r.tenant_id,
  jsonb_array_length(r.profile_data->'tables') as tables_in_jsonb,
  COUNT(t.id) as tables_in_table,
  CASE 
    WHEN jsonb_array_length(r.profile_data->'tables') = COUNT(t.id) THEN 'OK'
    WHEN jsonb_array_length(r.profile_data->'tables') > COUNT(t.id) THEN 'PARTIAL'
    WHEN jsonb_array_length(r.profile_data->'tables') < COUNT(t.id) THEN 'EXTRA'
    ELSE 'NO DATA'
  END as migration_status
FROM restaurants r
LEFT JOIN tables t ON t.restaurant_id = r.id
GROUP BY r.id, r.tenant_id, r.profile_data->'tables';

-- Grant access to the view
GRANT SELECT ON migration_verification TO authenticated;

-- Note: After verifying migration is successful, you can optionally:
-- 1. Remove tables from profile_data (keep for backward compatibility initially)
-- 2. Update application code to read from tables table instead of profile_data
-- 3. Create a trigger to keep them in sync during transition period
