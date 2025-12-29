# Implementation Prompt: Configurable Kiosk Inactivity Timeout

## Context

This is a multi-tenant restaurant voice AI application ("menyo!") built with:
- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4
- **Backend:** Supabase (PostgreSQL) + Vercel serverless functions
- **AI:** Google Gemini API with function calling
- **Database:** Supabase PostgreSQL with Row Level Security (RLS)

The application has a kiosk mode where customers can place orders or make reservations via chat/voice. Currently, the kiosk auto-resets after 5 minutes of inactivity (hardcoded). We need to make this timeout configurable by restaurant admins.

## Current Implementation

**File:** `App.tsx` (around line 640-658)

The auto-reset logic is currently hardcoded:

```typescript
// Auto-reset on inactivity (5 minutes)
useEffect(() => {
  if (kioskView !== 'ORDER' && kioskView !== 'RESERVE') return;
  
  const checkInterval = setInterval(() => {
    const timeSinceActivity = Date.now() - lastActivityTime;
    const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes (HARDCODED)
    
    if (timeSinceActivity >= INACTIVITY_TIMEOUT) {
      if (kioskChatHistory.length > 1 || orderState.items.length > 0) {
        if (kioskView === 'ORDER') {
          startNewOrder();
          setLastActivityTime(Date.now());
        } else {
          resetKioskSession();
          setLastActivityTime(Date.now());
        }
      }
    }
  }, 30000); // Check every 30 seconds

  return () => clearInterval(checkInterval);
}, [kioskView, lastActivityTime, kioskChatHistory.length, orderState.items.length]);
```

## Database Schema Context

**File:** `supabase/migrations/002_restaurants_schema.sql`

The `restaurants` table stores restaurant profiles in a JSONB `profile_data` column. Recent additions to the profile include:
- `maxGroupSize` (number)
- `maxGuestsPerHour` (number)
- `gloriaFoodsOrderMethod` ('HYBRID' | 'PUSH')
- `ownerEmail` (string)
- `gloriaFoodsRestaurantId` (string)

**No database migration needed** - we're adding a new field to the existing JSONB `profile_data` column, which doesn't require a schema change.

## TypeScript Types

**File:** `types.ts`

The `RestaurantProfile` interface (around line 181) currently includes:

```typescript
export interface RestaurantProfile {
  id: string;
  info: BusinessInfo;
  menuContext: string;
  menuData?: any;
  integrations: IntegrationStatus;
  voiceId: string;
  phoneNumber: string | null;
  gloriaFoodsToken?: string;
  gloriaFoodsRestaurantId?: string;
  gloriaFoodsOrderMethod?: 'HYBRID' | 'PUSH';
  ownerEmail?: string;
  bookingPreference: BookingPreference;
  customBookingUrl?: string;
  humanSupportPhone?: string;
  policies: Policies;
  editableSystemPrompt: string;
  
  // Reservation Settings
  maxGroupSize: number;
  maxGuestsPerHour: number;
  tables: TableLegacy[];
  
  // Security
  adminPassword?: string;
  connectedApps: ConnectedApp[];
}
```

## Profile Persistence

**File:** `App.tsx`

There's a `saveProfile()` function that persists profile changes to the database:

```typescript
const saveProfile = async (updatedProfile: RestaurantProfile) => {
  // Saves to Supabase restaurants table via PUT /api/restaurants/{id}
  // Uses profile_data JSONB column
};
```

This function is already used for auto-saving integration toggles and other profile changes.

## Settings UI Structure

**File:** `App.tsx`

Settings are organized in tabs:
- `settingsTab` state: 'KNOWLEDGE' | 'VOICE' | 'PHONE' | 'APPS' | 'SECURITY' | 'RESERVATIONS'

The RESERVATIONS tab has two views:
- `resViewMode` state: 'CALENDAR' | 'CONFIG'

In the CONFIG view (around line 2540-2570), there are already settings for:
- `maxGroupSize` (input field)
- `maxGuestsPerHour` (input field)
- Table inventory management

## Implementation Requirements

### 1. Add TypeScript Type

**File:** `types.ts`

Add to `RestaurantProfile` interface:

```typescript
// Kiosk Settings
kioskInactivityTimeoutMinutes?: number; // Auto-reset timeout in minutes (default: 5)
```

Place this after the Reservation Settings section and before Security section.

### 2. Update Default Profile State

**File:** `App.tsx` (around line 94-140)

In the `useState<RestaurantProfile>` initialization, add:

```typescript
const [profile, setProfile] = useState<RestaurantProfile>({
  // ... existing fields ...
  
  // Reservation Configuration
  maxGroupSize: 10,
  maxGuestsPerHour: 50,
  tables: [...],
  
  // Kiosk Configuration
  kioskInactivityTimeoutMinutes: 5, // Default 5 minutes
  
  // Security
  adminPassword: "Admin",
  // ...
});
```

### 3. Update Auto-Reset Logic

**File:** `App.tsx` (around line 640-658)

Replace the hardcoded timeout with:

```typescript
// Auto-reset on inactivity
useEffect(() => {
  if (kioskView !== 'ORDER' && kioskView !== 'RESERVE') return;
  
  const checkInterval = setInterval(() => {
    const timeSinceActivity = Date.now() - lastActivityTime;
    // Use profile setting with fallback to 5 minutes
    const timeoutMinutes = profile.kioskInactivityTimeoutMinutes || 5;
    const INACTIVITY_TIMEOUT = timeoutMinutes * 60 * 1000;
    
    // Only auto-reset if there's actual conversation/order data
    if (timeSinceActivity >= INACTIVITY_TIMEOUT) {
      if (kioskChatHistory.length > 1 || orderState.items.length > 0) {
        if (kioskView === 'ORDER') {
          startNewOrder();
          setLastActivityTime(Date.now());
        } else {
          resetKioskSession();
          setLastActivityTime(Date.now());
        }
      }
    }
  }, 30000); // Check every 30 seconds

  return () => clearInterval(checkInterval);
}, [kioskView, lastActivityTime, kioskChatHistory.length, orderState.items.length, profile.kioskInactivityTimeoutMinutes]);
```

**Important:** Add `profile.kioskInactivityTimeoutMinutes` to the dependency array so the effect re-runs when the setting changes.

### 4. Add UI Setting in RESERVATIONS Tab

**File:** `App.tsx` (in `renderReservationsSettings` function, around line 2540)

In the CONFIG view section (where `maxGroupSize` and `maxGuestsPerHour` are configured), add a new "Kiosk Settings" section:

```typescript
{resViewMode === 'CONFIG' && (
  <div className="flex-1 p-8 overflow-y-auto bg-slate-50">
    <div className="max-w-4xl mx-auto space-y-8">
      
      {/* Capacity Settings */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
          <Users className="w-5 h-5 text-brand-600" /> Dining Room Capacity Rules
        </h3>
        {/* ... existing maxGroupSize and maxGuestsPerHour inputs ... */}
      </div>

      {/* NEW: Kiosk Settings */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
          <MonitorPlay className="w-5 h-5 text-brand-600" /> Kiosk Settings
        </h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-bold text-slate-700 block mb-2">
              Auto-Reset Timeout (minutes)
            </label>
            <p className="text-xs text-slate-500 mb-3">
              How long to wait before automatically resetting the kiosk when inactive. 
              This ensures the next customer gets a fresh start. Range: 1-60 minutes.
            </p>
            <input
              type="number"
              min="1"
              max="60"
              value={profile.kioskInactivityTimeoutMinutes || 5}
              onChange={(e) => {
                const inputValue = parseInt(e.target.value);
                // Validate: ensure between 1-60, default to 5 if invalid
                const minutes = isNaN(inputValue) 
                  ? 5 
                  : Math.max(1, Math.min(60, inputValue));
                const updated = {...profile, kioskInactivityTimeoutMinutes: minutes};
                setProfile(updated);
                saveProfile(updated); // Auto-save on change
              }}
              className="w-full p-3 border border-slate-200 rounded-lg font-mono text-lg bg-white text-slate-900 focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-slate-400 mt-2">
              Current setting: <span className="font-semibold">{profile.kioskInactivityTimeoutMinutes || 5} minutes</span>
            </p>
          </div>
        </div>
      </div>

      {/* Table Matrix */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        {/* ... existing table inventory ... */}
      </div>
    </div>
  </div>
)}
```

### 5. Ensure Profile Loading Includes New Field

**File:** `App.tsx`

When the profile is loaded from the database (check the initial profile load logic), ensure the new field is included. The JSONB structure should automatically include it, but verify the profile loading doesn't strip unknown fields.

## Implementation Details

### Validation Rules
- Minimum: 1 minute
- Maximum: 60 minutes
- Default: 5 minutes (if not set or invalid)
- Type: number (integer)

### Auto-Save Behavior
- Use existing `saveProfile()` function
- Save immediately on input change (onChange handler)
- No "Save" button needed - follows existing pattern for other settings

### UI Placement
- Add in RESERVATIONS → Configure Rules & Tables view
- Place after "Dining Room Capacity Rules" section
- Before "Table Inventory" section
- Use same styling pattern as existing settings

### Dependencies
- Add `profile.kioskInactivityTimeoutMinutes` to the auto-reset useEffect dependency array
- This ensures the timeout updates immediately when changed

## Testing Checklist

After implementation, verify:

1. **Settings UI:**
   - [ ] Timeout input appears in RESERVATIONS → CONFIG view
   - [ ] Input accepts values 1-60
   - [ ] Input rejects values outside range (clamps to 1-60)
   - [ ] Default shows 5 minutes if not set
   - [ ] Current value displays correctly

2. **Persistence:**
   - [ ] Setting saves to database on change
   - [ ] Setting persists after page reload
   - [ ] Setting loads correctly from database

3. **Functionality:**
   - [ ] Auto-reset uses configured timeout value
   - [ ] Changing timeout updates behavior within 30 seconds (next check interval)
   - [ ] Fallback to 5 minutes works if value is missing/invalid
   - [ ] Works for both ORDER and RESERVE views

4. **Edge Cases:**
   - [ ] Empty/null value defaults to 5 minutes
   - [ ] Value of 0 defaults to 5 minutes
   - [ ] Value > 60 clamps to 60
   - [ ] Value < 1 clamps to 1
   - [ ] Non-numeric input handles gracefully

## Files to Modify

1. **`types.ts`**
   - Add `kioskInactivityTimeoutMinutes?: number` to `RestaurantProfile` interface

2. **`App.tsx`**
   - Add default value in profile state initialization (line ~128)
   - Update auto-reset useEffect to use profile setting (line ~640)
   - Add UI input in `renderReservationsSettings()` CONFIG view (line ~2540)
   - Add validation in onChange handler

## No Database Migration Required

Since we're using JSONB `profile_data` column, no SQL migration is needed. The new field will be stored automatically in the JSON structure.

## Related Code References

- Profile state initialization: `App.tsx` line ~94
- Auto-reset logic: `App.tsx` line ~640-658
- Settings UI: `App.tsx` line ~2400-2600 (renderReservationsSettings)
- Profile save function: `App.tsx` (search for `saveProfile`)
- Type definitions: `types.ts` line ~181

## Expected Behavior

1. Admin navigates to Settings → Reservations → Configure Rules & Tables
2. Sees "Kiosk Settings" section with timeout input
3. Changes value (e.g., from 5 to 10 minutes)
4. Setting auto-saves immediately
5. Next time kiosk is used, auto-reset happens after configured timeout
6. If customer is inactive for 10 minutes (in example), system auto-resets

## Notes

- The timeout check runs every 30 seconds, so changes take effect within 30 seconds
- The setting applies to both ORDER and RESERVE kiosk views
- The timeout only triggers if there's actual conversation/order data
- Activity tracking resets the timer on any user interaction
