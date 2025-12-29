// Order State Management
// Tracks order data during conversation for structured collection

import type { OrderItem } from '../types';

export interface OrderState {
  items: OrderItem[];
  customerName?: string;
  phone?: string;
  email?: string;
  orderType?: 'PICKUP' | 'DELIVERY';
  deliveryAddress?: string;
  specialInstructions?: string;
}

export function createOrderState(): OrderState {
  return {
    items: [],
  };
}

export function addItemToOrder(
  state: OrderState,
  itemId: string,
  itemName: string,
  quantity: number,
  price: number,
  modifiers?: Array<{ modifierId: string; optionId: string }>,
  specialInstructions?: string
): OrderState {
  // Check if item already exists
  const existingIndex = state.items.findIndex(item => item.itemId === itemId);
  
  if (existingIndex >= 0) {
    // Update existing item quantity
    const updatedItems = [...state.items];
    updatedItems[existingIndex] = {
      ...updatedItems[existingIndex],
      quantity: updatedItems[existingIndex].quantity + quantity,
    };
    return { ...state, items: updatedItems };
  } else {
    // Add new item
    return {
      ...state,
      items: [
        ...state.items,
        {
          itemId,
          itemName,
          quantity,
          price,
          modifiers,
          specialInstructions,
        },
      ],
    };
  }
}

export function removeItemFromOrder(state: OrderState, itemId: string): OrderState {
  return {
    ...state,
    items: state.items.filter(item => item.itemId !== itemId),
  };
}

export function updateItemQuantity(
  state: OrderState,
  itemId: string,
  quantity: number
): OrderState {
  if (quantity <= 0) {
    return removeItemFromOrder(state, itemId);
  }
  
  return {
    ...state,
    items: state.items.map(item =>
      item.itemId === itemId ? { ...item, quantity } : item
    ),
  };
}

export function setCustomerInfo(
  state: OrderState,
  name: string,
  phone: string,
  email?: string
): OrderState {
  return {
    ...state,
    customerName: name,
    phone,
    email,
  };
}

export function setOrderPreferences(
  state: OrderState,
  orderType: 'PICKUP' | 'DELIVERY',
  deliveryAddress?: string,
  specialInstructions?: string
): OrderState {
  return {
    ...state,
    orderType,
    deliveryAddress,
    specialInstructions: specialInstructions || state.specialInstructions,
  };
}

export function calculateTotal(state: OrderState): number {
  return state.items.reduce((total, item) => {
    let itemTotal = item.price * item.quantity;
    // Add modifier prices if available (would need to fetch from menu)
    return total + itemTotal;
  }, 0);
}

export function isOrderComplete(state: OrderState): boolean {
  return (
    state.items.length > 0 &&
    !!state.customerName &&
    !!state.phone &&
    !!state.orderType
  );
}
