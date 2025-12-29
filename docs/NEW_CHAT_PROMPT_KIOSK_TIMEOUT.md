# New Chat Thread Prompt: Implement Configurable Kiosk Inactivity Timeout

Copy and paste this entire prompt into a new chat thread to implement the feature.

---

## Task: Make Kiosk Inactivity Timeout Configurable in Settings

### Project Context

This is a multi-tenant restaurant voice AI application ("menyo!") where:
- Restaurant admins configure their restaurant profile through a Settings UI
- Customers use a kiosk mode to place orders or make reservations via chat/voice
- The kiosk currently auto-resets after 5 minutes of inactivity (hardcoded)
- We need to make this timeout configurable per restaurant

### Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4
- **Backend:** Supabase (PostgreSQL) + Vercel serverless functions
- **Database:** Supabase PostgreSQL with JSONB `profile_data` column in `restaurants` table
- **State Management:** React useState/useEffect
- **Profile Persistence:** `saveProfile()` function that PUTs to `/api/restaurants/{id}`

### Current Implementation

**File:** `App.tsx` (line ~640-658)

The auto-reset timeout is hardcoded to 5 minutes:

```typescript
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes (HARDCODED)
```

This is used in a `useEffect` hook that checks every 30 seconds for inactivity and resets the kiosk if no activity for the timeout duration.

### Database Schema

**File:** `supabase/migrations/002_restaurants_schema.sql`

The `restaurants` table has:
- `profile_data JSONB NOT NULL` - Stores the entire restaurant profile as JSON
- No schema migration needed - we're adding a field to existing JSONB structure

Recent profile fields include:
- `maxGroupSize: number`
- `maxGuestsPerHour: number`
- `gloriaFoodsOrderMethod: 'HYBRID' | 'PUSH'`
- `ownerEmail: string`
- `gloriaFoodsRestaurantId: string`

### TypeScript Types

**File:** `types.ts` (line ~181)

The `RestaurantProfile` interface needs a new field:

```typescript
export interface RestaurantProfile {
  // ... existing fields ...
  
  // Reservation Settings
  maxGroupSize: number;
  maxGuestsPerHour: number;
  tables: TableLegacy[];
  
  // ADD THIS:
  // Kiosk Settings
  kioskInactivityTimeoutMinutes?: number; // Auto-reset timeout in minutes (default: 5)
  
  // Security
  adminPassword?: string;
  // ...
}
```

### Settings UI Location

**File:** `App.tsx`

Settings are organized in tabs. The RESERVATIONS tab has a CONFIG view where `maxGroupSize` and `maxGuestsPerHour` are configured (around line 2540-2570).

Add the new timeout setting in the same CONFIG view, after the "Dining Room Capacity Rules" section and before the "Table Inventory" section.

### Profile Persistence

**File:** `App.tsx` (line ~174)

There's an existing `saveProfile()` function:

```typescript
const saveProfile = async (updatedProfile: RestaurantProfile) => {
  // Gets current restaurant, updates profile_data JSONB column
  // PUTs to /api/restaurants/{id}
  // Auto-saves on change
};
```

Use this function in the onChange handler to persist the timeout setting.

### Implementation Requirements

1. **Add Type Definition**
   - File: `types.ts`
   - Add `kioskInactivityTimeoutMinutes?: number` to `RestaurantProfile` interface
   - Place after Reservation Settings, before Security section

2. **Update Default Profile State**
   - File: `App.tsx` (line ~94-140)
   - Add `kioskInactivityTimeoutMinutes: 5` to initial profile state

3. **Update Auto-Reset Logic**
   - File: `App.tsx` (line ~640-658)
   - Replace hardcoded `5 * 60 * 1000` with: `(profile.kioskInactivityTimeoutMinutes || 5) * 60 * 1000`
   - Add `profile.kioskInactivityTimeoutMinutes` to useEffect dependency array

4. **Add Settings UI**
   - File: `App.tsx` (in `renderReservationsSettings`, CONFIG view, around line 2570)
   - Add new "Kiosk Settings" section with:
     - Title: "Kiosk Settings" with MonitorPlay icon
     - Label: "Auto-Reset Timeout (minutes)"
     - Description: "How long to wait before automatically resetting the kiosk when inactive. This ensures the next customer gets a fresh start. Range: 1-60 minutes."
     - Input: number type, min=1, max=60, default=5
     - Validation: clamp to 1-60 range
     - Auto-save on change using `saveProfile()`
     - Display current value below input

5. **Validation Rules**
   - Minimum: 1 minute
   - Maximum: 60 minutes
   - Default: 5 minutes (if not set or invalid)
   - Handle NaN, null, undefined gracefully

### UI Styling Pattern

Match the existing "Dining Room Capacity Rules" section styling:
- White background card with rounded-2xl
- Border border-slate-200
- Shadow-sm
- Same input styling as maxGroupSize/maxGuestsPerHour inputs
- Use MonitorPlay icon (already imported)

### Code Snippets Reference

**Profile State Initialization** (line ~128):
```typescript
maxGroupSize: 10,
maxGuestsPerHour: 50,
// ADD: kioskInactivityTimeoutMinutes: 5,
```

**Auto-Reset Logic** (line ~643):
```typescript
// REPLACE THIS:
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// WITH THIS:
const timeoutMinutes = profile.kioskInactivityTimeoutMinutes || 5;
const INACTIVITY_TIMEOUT = timeoutMinutes * 60 * 1000;
```

**Settings UI** (after line 2570):
```typescript
{/* Kiosk Settings */}
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
          const minutes = isNaN(inputValue) 
            ? 5 
            : Math.max(1, Math.min(60, inputValue));
          const updated = {...profile, kioskInactivityTimeoutMinutes: minutes};
          setProfile(updated);
          saveProfile(updated);
        }}
        className="w-full p-3 border border-slate-200 rounded-lg font-mono text-lg bg-white text-slate-900 focus:ring-2 focus:ring-brand-500"
      />
      <p className="text-xs text-slate-400 mt-2">
        Current setting: <span className="font-semibold">{profile.kioskInactivityTimeoutMinutes || 5} minutes</span>
      </p>
    </div>
  </div>
</div>
```

### Testing Requirements

After implementation, verify:
1. Setting appears in RESERVATIONS → Configure Rules & Tables
2. Input accepts 1-60 range, clamps invalid values
3. Setting saves immediately on change
4. Setting persists after page reload
5. Auto-reset uses configured timeout (test with 1 minute for quick verification)
6. Defaults to 5 minutes if not set

### Important Notes

- **No database migration needed** - JSONB column handles new fields automatically
- **Auto-save pattern** - Use `saveProfile()` immediately on change (like other settings)
- **Dependency array** - Must include `profile.kioskInactivityTimeoutMinutes` in useEffect deps
- **Fallback logic** - Always use `|| 5` as fallback for safety
- **Validation** - Clamp to 1-60 range, handle NaN gracefully

### Files to Modify

1. `types.ts` - Add field to interface
2. `App.tsx` - Update default state, auto-reset logic, and add UI

### Expected User Flow

1. Admin goes to Settings → Reservations tab
2. Clicks "Configure Rules & Tables" button
3. Scrolls to "Kiosk Settings" section
4. Changes timeout from 5 to desired value (e.g., 10 minutes)
5. Setting auto-saves
6. Next time kiosk is used, auto-reset happens after configured timeout

---

**Please implement this feature following the requirements above. Work in manageable chunks and test as you go.**
