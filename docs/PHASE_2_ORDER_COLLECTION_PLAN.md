# Phase 2: Enhanced Order Collection & Menu Interaction

## Overview
This phase focuses on improving the order collection experience using Gemini Function Calling and enhanced menu features to minimize friction and create a more engaging, "new again" experience for customers.

## Goals
1. Replace placeholder `extractOrderItems` with structured Gemini Function Calling
2. Store structured menu data alongside text context
3. Support menu images in chat
4. Enable dynamic menu filtering (dietary restrictions, categories, etc.)
5. Track conversation state for order collection
6. Enhance chat UI with images and expandable grids

## Implementation Plan

### Task 1: Structured Menu State Management
- Add `menuData?: GloriaFoodsMenu` to `RestaurantProfile`
- Update menu sync to store both `menuContext` (text) and `menuData` (JSON)
- Update `syncGloriaFoodsMenu()` to save structured data

### Task 2: Gemini Function Calling for Order Collection
- Add new method `sendChatMessageWithFunctions()` to `GeminiService`
- Define function declarations:
  - `add_item_to_order(itemId, quantity, modifications?)`
  - `remove_item_from_order(itemId)`
  - `update_item_quantity(itemId, quantity)`
  - `set_customer_info(name, phone, email?)`
  - `set_order_preferences(orderType, deliveryAddress?, specialInstructions?)`
  - `get_menu_items(category?, filters?, limit?)`
  - `get_menu_item_details(itemId)`
- Handle function calls and maintain order state

### Task 3: Conversation State Management
- Create `OrderState` interface to track:
  - Items array
  - Customer info
  - Order preferences
  - Special instructions
- Update chat handlers to maintain state
- Pass state to function handlers

### Task 4: Menu Helper Functions
- Implement `getMenuItems()` - filter by category, dietary restrictions, price
- Implement `getMenuItemDetails()` - get full item info with modifiers
- Support filtering by keywords (e.g., "gluten-free", "vegetarian")

### Task 5: Image Support in Chat
- Check if Gloria Foods API provides item images
- Add image display in chat UI
- Support full menu image upload/viewing

### Task 6: Enhanced Chat UI
- Display menu items with images and prices
- Expandable grids (6 → 12 items)
- Filter UI for dietary restrictions
- Order summary sidebar

### Task 7: System Prompt Updates
- Update prompt to use structured menu data
- Add function calling instructions
- Guide AI on when to call functions

## Files to Create/Modify

### New Files:
- `lib/orderState.ts` - Order state management
- `lib/menuHelpers.ts` - Menu filtering and search functions

### Modified Files:
- `services/geminiService.ts` - Add function calling support
- `types.ts` - Add OrderState, update RestaurantProfile
- `App.tsx` - Update order collection flow, add state management
- `api/gloria-foods/menu.ts` - Return structured menu data

## Testing Checklist
- [ ] Function calling works for adding items
- [ ] Menu filtering by dietary restrictions works
- [ ] Order state persists during conversation
- [ ] Images display in chat (if available)
- [ ] Order extraction works without regex
- [ ] Customer info collection works via functions
- [ ] Special instructions captured correctly
