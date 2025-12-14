
export interface MenuItem {
  category: string;
  name: string;
  price: string;
  description: string;
}

export interface BusinessInfo {
  name: string;
  address: string;
  hours: string;
  phone: string;
  website: string;
  cuisine: string;
}

export interface IntegrationStatus {
  googleBusiness: boolean;
  gloriaFoodsOrders: boolean;      // NEW: For menu/orders
  gloriaFoodsCalendar: boolean;    // NEW: For reservations
  googleCalendar: boolean;          // NEW: For calendar sync
  twilio: boolean;
}

export type BookingPreference = 'HUMAN_SUPPORT' | 'GLORIA_FOODS' | 'CUSTOM';

export interface Policies {
  dietaryRestrictions: string;
  kidsZone: string;
  accessibility: string;
  largeParties: string; // e.g., "For parties over 8, please call..."
}

export interface ConnectedApp {
  id: string;
  name: string;
  type: 'API' | 'WEBHOOK' | 'OTHER';
  isDefault: boolean;
  config: {
    webhookIncoming?: string;
    webhookOutgoing?: string;
    apiKey?: string;
    accountName?: string;
    accountPassword?: string;
    supportPhone?: string;
    supportEmail?: string;
  };
}

// Table Types (matches database schema)
export interface Table {
  id: string;
  restaurant_id: string;
  tenant_id: string;
  table_number: number;
  name: string;
  max_guests: number;
  min_guests?: number;
  location?: string; // e.g., "Indoor", "Patio", "Window", "Private Room"
  features?: string[]; // e.g., ["wheelchair_accessible", "high_chair", "outdoor"]
  is_active?: boolean;
  created_at: string;
  updated_at: string;
}

// Legacy Table interface for backward compatibility (used in RestaurantProfile)
export interface TableLegacy {
  id: string;
  autoNumber: number;
  name: string;
  maxGuests: number;
}

// Reservation Source Types
export type ReservationSource = 'LOCAL' | 'GLORIA_FOODS' | 'GOOGLE_CALENDAR' | 'PHONE' | 'WALK_IN';

// Reservation Types (matches enhanced database schema)
export interface Reservation {
  id: string;
  restaurant_id: string;
  tenant_id: string;
  customer_name: string;
  date: string; // YYYY-MM-DD (legacy, use reservation_datetime)
  time: string; // TIME format (legacy, use reservation_datetime)
  reservation_datetime?: string; // ISO 8601 TIMESTAMPTZ
  end_datetime?: string; // ISO 8601 TIMESTAMPTZ (auto-calculated)
  duration_minutes?: number; // Default 120 (2 hours)
  party_size: number;
  status: 'CONFIRMED' | 'PENDING' | 'CANCELLED';
  phone?: string;
  email?: string;
  notes?: string; // Legacy field
  customer_notes?: string; // Customer's special notes
  internal_notes?: string; // Staff notes (not visible to customer)
  special_requests?: string; // Dietary restrictions, accessibility needs, etc.
  table_ids?: string[]; // Legacy array (use reservation_tables junction table)
  has_conflict?: boolean; // Legacy field
  gloria_foods_reservation_id?: string; // External ID from Gloria Foods
  source?: ReservationSource; // Default 'LOCAL'
  confirmed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  no_show?: boolean;
  checked_in_at?: string;
  checked_out_at?: string;
  created_at: string;
  updated_at: string;
}

// Reservation-Tables junction table (many-to-many)
export interface ReservationTable {
  id: string;
  reservation_id: string;
  table_id: string;
  created_at: string;
}

// Time Slot Capacity (for availability checking)
export interface TimeSlotCapacity {
  id: string;
  restaurant_id: string;
  tenant_id: string;
  slot_date: string; // DATE format YYYY-MM-DD
  slot_time: string; // TIME format HH:MM:SS
  slot_duration_minutes: number; // 30 or 60
  total_capacity: number;
  reserved_guests: number;
  available_capacity: number; // Generated: total_capacity - reserved_guests
  table_count?: number;
  created_at: string;
  updated_at: string;
}

// Availability Check Result
export interface AvailabilityCheckResult {
  is_available: boolean;
  available_capacity: number;
  current_reserved_guests: number;
  total_capacity: number;
  conflicting_reservations: number;
}

// Order Types for Gloria Foods Integration
export interface OrderItem {
  itemId: string;
  itemName: string;
  quantity: number;
  price: number;
  modifiers?: Array<{
    modifierId: string;
    optionId: string;
  }>;
  specialInstructions?: string;
}

export interface Order {
  id: string;
  restaurantId: string;
  tenantId: string;
  gloriaFoodsOrderId?: string; // External order ID from Gloria Foods
  customerName: string;
  phone: string;
  email?: string;
  items: OrderItem[];
  orderType: 'PICKUP' | 'DELIVERY';
  deliveryAddress?: string;
  total: number;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
  checkoutUrl?: string; // For hybrid approach - redirect URL
  estimatedReadyTime?: string;
  actualReadyTime?: string;
  specialInstructions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RestaurantProfile {
  id: string;
  info: BusinessInfo;
  menuContext: string; // The raw text extracted/summarized from menus for the AI
  integrations: IntegrationStatus;
  voiceId: string; // Gemini voice name
  phoneNumber: string | null;
  gloriaFoodsToken?: string;
  
  // New Knowledge Base Fields
  bookingPreference: BookingPreference;
  customBookingUrl?: string;
  humanSupportPhone?: string;
  policies: Policies;
  editableSystemPrompt: string; // The final source of truth for the bot
  
  // Reservation Settings
  maxGroupSize: number;
  maxGuestsPerHour: number;
  tables: TableLegacy[]; // Legacy format (stored in JSONB, will migrate to tables table)

  // Security
  adminPassword?: string;

  // Connected Apps
  connectedApps: ConnectedApp[];
}

export enum VoiceOption {
  Zephyr = 'Zephyr',
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
}

// Authentication Types
export type UserRole = 'super-admin' | 'admin' | 'user';
export type PlanType = 'FREE' | 'PRO' | 'ENTERPRISE';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  user_id: string;
  tenant_id: string | null;
  plan: PlanType;
  profile_data: RestaurantProfile | null;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  name: string;
  owner_id: string;
  plan: PlanType;
  created_at: string;
  updated_at: string;
}
