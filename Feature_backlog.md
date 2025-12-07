
# menyo! Feature Backlog & Technical Debt

## 1. Calendar Integrations (Priority: High)
**Current Status:** Mocked UI in Settings > Reservations.

### Requirements:
- **Google Calendar Sync**:
  - Implement OAuth2 flow to read/write events to a specific calendar.
  - Map `Reservation` objects to Google Calendar `Event` objects.
  - Two-way sync: Updates in Google Calendar should reflect in Menyo dashboard.
- **Gloria Foods Calendar**:
  - Use existing API token to fetch table reservations.
  - Webhook listener for new reservation events.
- **iCal / Outlook**:
  - Provide an `.ics` subscription URL for the restaurant to import.

## 2. Capacity & Conflict Logic (Priority: High)
**Current Status:** UI fields added for Max Guests/Hour and Table Matrix.

### Requirements:
- **Max Guests Per Hour**:
  - Backend validation: When a new reservation comes in via Voice/Chat, query database for total covers in that hour slot.
  - If `currentCovers + partySize > maxGuestsPerHour`, the bot should offer alternative times.
- **Table Optimization**:
  - "Tetris" algorithm to automatically assign `tableIds` based on `partySize` and `table.maxGuests`.
  - Avoid putting a party of 2 on a 6-top unless necessary.

## 3. Connected Apps Logic (Priority: Medium)
**Current Status:** UI for configuration exists; backend logic is simulated.

### Requirements:
- **Middleware Layer**: 
  - Build a server-side proxy to handle API requests between Menyo and Gloria Foods/Zapier.
  - Securely store API keys (currently in local state).
- **Webhooks**:
  - **Incoming**: Real endpoint to parse JSON payloads and trigger Bot actions (e.g., "Order Ready" triggers a voice call to customer).
  - **Outgoing**: Trigger webhooks on specific conversation events (e.g., `RESERVATION_CONFIRMED`, `ORDER_PLACED`).

## 4. Kiosk Mode Chat (Priority: Medium)
**Current Status:** "Order" and "Reserve" tabs in Kiosk mode use a simulated chat history.

### Requirements:
- **Live Text Chat**: Connect the Kiosk `ORDER` and `RESERVE` inputs to the `GeminiService.sendChatMessage` method (currently only used in the Admin Test modal).
- **Context Awareness**: 
  - The "Order" chat should implicitly use a System Prompt focused on menu items.
  - The "Reserve" chat should use a System Prompt focused on availability.

## 5. Voice Bot Telephony (Priority: High)
**Current Status:** Browser-based audio streaming (WebRTC/WebSocket).

### Requirements:
- **Twilio Integration**:
  - Purchase real phone numbers via Twilio API.
  - **SIP Trunking**: Connect Twilio Media Streams to the Gemini Live API WebSocket for real phone call handling.
  - **Latency Optimization**: Ensure <500ms response time for natural voice feel.

## 6. Security
**Current Status:** Basic client-side password check.

### Requirements:
- **Auth**: Implement real user authentication (Firebase Auth or Supabase).
- **RBAC**: Role-Based Access Control (Owner vs Manager vs Staff).
- **Encryption**: Encrypt API keys and passwords in the database.
