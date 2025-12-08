<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# menyo! - Restaurant Voice AI

This contains everything you need to run your app locally and deploy to Vercel.

## Prerequisites

- Node.js
- Supabase account and project
- Gemini API key (for development)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up Supabase:**
   - Create a new Supabase project at https://supabase.com
   - Run the migrations in `supabase/migrations/` in order:
     - `001_auth_schema.sql`
     - `002_restaurants_schema.sql`
   - Get your Supabase URL and anon key from project settings

3. **Create `.env.local` file:**
   ```env
   # Gemini API Key (for development fallback)
   GEMINI_API_KEY=your_gemini_api_key_here
   
   # Supabase Configuration
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   
   # For Vercel API routes (server-side only)
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   ENCRYPTION_KEY=your_encryption_key_for_api_keys
   
   # Super Admin Email (for first-time setup)
   SUPER_ADMIN_EMAIL=your_email@example.com
   ```

4. **Run the app:**
   ```bash
   npm run dev
   ```

## Deployment to Vercel

1. Push your code to GitHub
2. Import project in Vercel
3. Add all environment variables from `.env.local` to Vercel project settings
4. Deploy!

## Features

- **User Authentication**: Supabase Auth with automatic profile creation
- **Multi-tenant Support**: Each tenant has their own data and API keys
- **Role-based Access**: super-admin, admin, and user roles
- **Secure API Key Storage**: Tenant API keys encrypted in Supabase
- **Restaurant Profiles**: Stored in Supabase with tenant isolation
