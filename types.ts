
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
  gloriaFoods: boolean;
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

export interface Table {
  id: string;
  autoNumber: number;
  name: string;
  maxGuests: number;
}

export interface Reservation {
  id: string;
  customerName: string;
  time: string; // ISO string or simple time string for mock
  date: string; // YYYY-MM-DD
  partySize: number;
  status: 'CONFIRMED' | 'PENDING' | 'CANCELLED';
  phone: string;
  notes?: string;
  tableIds?: string[];
  hasConflict?: boolean;
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
  tables: Table[];

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
