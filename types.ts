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
}

export enum VoiceOption {
  Zephyr = 'Zephyr',
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
}