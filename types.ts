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

export interface RestaurantProfile {
  id: string;
  info: BusinessInfo;
  menuContext: string; // The raw text extracted/summarized from menus for the AI
  integrations: IntegrationStatus;
  voiceId: string; // Gemini voice name
  phoneNumber: string | null;
  gloriaFoodsToken?: string;
}

export enum VoiceOption {
  Zephyr = 'Zephyr',
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
}