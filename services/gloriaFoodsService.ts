// Gloria Foods API Service
// Handles menu fetching, order preparation, and status checking

export interface GloriaFoodsMenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  available: boolean;
  modifiers?: GloriaFoodsModifier[];
}

export interface GloriaFoodsModifier {
  id: string;
  name: string;
  options: Array<{
    id: string;
    name: string;
    price: number;
  }>;
}

export interface GloriaFoodsMenu {
  restaurant_id: string;
  restaurant_name: string;
  categories: Array<{
    id: string;
    name: string;
    items: GloriaFoodsMenuItem[];
  }>;
  hours?: {
    [key: string]: { open: string; close: string };
  };
}

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

export interface OrderData {
  customerName: string;
  phone: string;
  email?: string;
  items: OrderItem[];
  orderType: 'PICKUP' | 'DELIVERY';
  deliveryAddress?: string;
  specialInstructions?: string;
  estimatedReadyTime?: string;
}

export interface PreparedOrder {
  orderId: string;
  checkoutUrl: string;
  total: number;
  estimatedReadyTime: string;
  items: OrderItem[];
}

export interface OrderStatus {
  orderId: string;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
  estimatedReadyTime?: string;
  actualReadyTime?: string;
}

export class GloriaFoodsService {
  private baseUrl = 'https://pos.globalfoodsoft.com/pos';
  private restaurantToken: string;
  private masterKey?: string;

  constructor(restaurantToken: string, masterKey?: string) {
    this.restaurantToken = restaurantToken;
    this.masterKey = masterKey;
  }

  /**
   * Submit order directly to Gloria Foods API v2 (PUSH method)
   * Uses Accepted Orders API v2 to send order directly to GF
   * Returns order confirmation with GF order ID
   * 
   * Note: restaurantId should be passed separately (from restaurant profile)
   */
  async submitOrder(orderData: OrderData, restaurantId?: number): Promise<{
    orderId: string;
    status: 'CONFIRMED' | 'PENDING';
    total: number;
    estimatedReadyTime?: string;
  }> {
    if (!this.masterKey) {
      throw new Error('Master key required for PUSH method. Please configure GLORIA_FOODS_MASTER_KEY.');
    }

    try {
      // Calculate total
      const total = orderData.items.reduce((sum, item) => {
        let itemTotal = item.price * item.quantity;
        // Add modifier prices if any
        // Note: This would need actual modifier pricing from API
        return sum + itemTotal;
      }, 0);

      // Transform order items to GF API v2 format
      const gfItems = orderData.items.map(item => ({
        id: parseInt(item.itemId) || 0,
        name: item.itemName,
        quantity: item.quantity,
        price: item.price,
        // Add modifiers/options if available
        options: item.modifiers?.map(mod => ({
          id: parseInt(mod.modifierId) || 0,
          option_id: parseInt(mod.optionId) || 0,
        })) || [],
        special_instructions: item.specialInstructions,
      }));

      // Split customer name into first/last
      const nameParts = orderData.customerName.trim().split(/\s+/);
      const firstName = nameParts[0] || orderData.customerName;
      const lastName = nameParts.slice(1).join(' ') || '';

      // Prepare order payload for GF API v2 (Accepted Orders format)
      // Note: restaurant_id should be the numeric GF restaurant ID, not the token
      const payload = {
        restaurant_id: restaurantId || 0, // Use provided restaurantId or 0 (GF will use token to identify)
        client_first_name: firstName,
        client_last_name: lastName,
        client_phone: orderData.phone,
        client_email: orderData.email || '',
        type: orderData.orderType.toLowerCase(), // pickup, delivery, table_reservation, order_ahead, dine_in
        items: gfItems,
        total_price: total,
        delivery_address: orderData.deliveryAddress || '',
        special_instructions: orderData.specialInstructions || '',
      };

      // Submit order to GF Accepted Orders API v2
      // Note: Endpoint may need to be verified with GF documentation
      const response = await fetch(`${this.baseUrl}/orders`, {
        method: 'POST',
        headers: {
          'Authorization': this.masterKey, // Master key for PUSH method (raw token, not Bearer)
          'Glf-Api-Version': '2',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gloria Foods API error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      const data = await response.json();
      
      // GF API v2 returns order with id, status, etc.
      return {
        orderId: String(data.id || data.order_id || this.generateOrderId()),
        status: data.status === 'accepted' || data.status === 'confirmed' ? 'CONFIRMED' : 'PENDING',
        total: data.total_price || total,
        estimatedReadyTime: data.fulfill_at || data.estimated_ready_time || this.estimateReadyTime(orderData.items),
      };
    } catch (error) {
      console.error('Error submitting order to Gloria Foods:', error);
      throw new Error(`Failed to submit order: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch menu from Gloria Foods API v2
   * Returns structured menu data for AI context
   * Uses GF API v2 format: Authorization header with raw token (not Bearer), Glf-Api-Version: 2
   */
  async fetchMenu(): Promise<GloriaFoodsMenu> {
    try {
      const response = await fetch(`${this.baseUrl}/menu`, {
        method: 'GET',
        headers: {
          'Authorization': this.restaurantToken, // Raw token, not Bearer (GF API v2 format)
          'Glf-Api-Version': '2', // Required for API v2
          'Accept': 'application/json', // Request JSON format
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gloria Foods API error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      const data = await response.json();
      
      // Transform Gloria Foods API v2 response to our format
      return this.transformMenuResponse(data);
    } catch (error) {
      console.error('Error fetching Gloria Foods menu:', error);
      throw new Error('Failed to fetch menu from Gloria Foods. Please check your API token.');
    }
  }

  /**
   * Transform Gloria Foods API v2 response to our Menu format
   * GF API v2 structure: { id, restaurant_id, currency, categories: [{ id, name, items, groups }] }
   */
  private transformMenuResponse(data: any): GloriaFoodsMenu {
    // Transform GF API v2 categories structure
    const categories = (data.categories || []).map((cat: any) => {
      // Transform items from GF API v2 format
      const items = (cat.items || []).map((item: any) => {
        // Get default price from item or first size
        let price = item.price || 0;
        if (item.sizes && item.sizes.length > 0) {
          const defaultSize = item.sizes.find((s: any) => s.default) || item.sizes[0];
          price = defaultSize.price || price;
        }

        // Transform option groups to modifiers
        const modifiers: GloriaFoodsModifier[] = [];
        if (item.groups && item.groups.length > 0) {
          item.groups.forEach((group: any) => {
            modifiers.push({
              id: String(group.id),
              name: group.name,
              options: (group.options || []).map((opt: any) => ({
                id: String(opt.id),
                name: opt.name,
                price: opt.price || 0,
              })),
            });
          });
        }

        // Check availability (item is available if not explicitly marked unavailable)
        const available = item.available !== false;

        return {
          id: String(item.id),
          name: item.name || '',
          description: item.description || undefined,
          price: price,
          category: cat.name || '',
          available: available,
          modifiers: modifiers.length > 0 ? modifiers : undefined,
        };
      });

      return {
        id: String(cat.id),
        name: cat.name || '',
        items: items,
      };
    });

    return {
      restaurant_id: String(data.restaurant_id || data.id || ''),
      restaurant_name: data.restaurant_name || '',
      categories: categories,
      hours: data.hours || {},
    };
  }

  /**
   * Convert Gloria Foods menu to text format for AI context
   */
  async getMenuContext(): Promise<string> {
    try {
      const menu = await this.fetchMenu();
      
      let context = `MENU FOR ${menu.restaurant_name}:\n\n`;
      
      menu.categories.forEach(category => {
        context += `\n${category.name.toUpperCase()}:\n`;
        category.items.forEach(item => {
          if (item.available) {
            context += `- ${item.name}`;
            if (item.description) {
              context += ` (${item.description})`;
            }
            context += ` - $${item.price.toFixed(2)}\n`;
            
            if (item.modifiers && item.modifiers.length > 0) {
              context += `  Modifiers: ${item.modifiers.map(m => m.name).join(', ')}\n`;
            }
          }
        });
      });

      if (menu.hours) {
        context += `\nHOURS:\n`;
        Object.entries(menu.hours).forEach(([day, times]) => {
          context += `${day}: ${times.open} - ${times.close}\n`;
        });
      }

      return context;
    } catch (error) {
      console.error('Error generating menu context:', error);
      return 'Menu information unavailable.';
    }
  }

  /**
   * Check if a menu item is available
   */
  async checkAvailability(itemId: string): Promise<boolean> {
    try {
      const menu = await this.fetchMenu();
      
      for (const category of menu.categories) {
        const item = category.items.find(i => i.id === itemId);
        if (item) {
          return item.available;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking availability:', error);
      return false;
    }
  }

  /**
   * Prepare order - collects all details and returns checkout URL
   * This is the hybrid approach: we collect everything, then redirect to Gloria Foods for payment
   */
  async prepareOrder(orderData: OrderData): Promise<PreparedOrder> {
    try {
      // Calculate total
      const total = orderData.items.reduce((sum, item) => {
        let itemTotal = item.price * item.quantity;
        // Add modifier prices if any
        // Note: This would need actual modifier pricing from API
        return sum + itemTotal;
      }, 0);

      // Call Gloria Foods API to create a draft order
      // This endpoint should exist or we'll need to construct the checkout URL manually
      const response = await fetch(`${this.baseUrl}/orders/prepare`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.restaurantToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: orderData.items,
          customer: {
            name: orderData.customerName,
            phone: orderData.phone,
            email: orderData.email,
          },
          orderType: orderData.orderType,
          deliveryAddress: orderData.deliveryAddress,
          specialInstructions: orderData.specialInstructions,
        }),
      });

      if (!response.ok) {
        // If API doesn't support prepare endpoint, construct checkout URL manually
        return this.constructCheckoutUrl(orderData, total);
      }

      const data = await response.json();
      
      return {
        orderId: data.order_id || this.generateOrderId(),
        checkoutUrl: data.checkout_url || this.constructCheckoutUrl(orderData, total).checkoutUrl,
        total: data.total || total,
        estimatedReadyTime: data.estimated_ready_time || this.estimateReadyTime(orderData.items),
        items: orderData.items,
      };
    } catch (error) {
      console.error('Error preparing order:', error);
      // Fallback: construct checkout URL manually
      const total = orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      return this.constructCheckoutUrl(orderData, total);
    }
  }

  /**
   * Construct checkout URL manually if API doesn't support prepare endpoint
   * This creates a URL with pre-filled order data that Gloria Foods can process
   */
  private constructCheckoutUrl(orderData: OrderData, total: number): PreparedOrder {
    // Generate a temporary order ID
    const orderId = this.generateOrderId();
    
    // Construct checkout URL with order data as query params
    // Format may vary based on Gloria Foods actual implementation
    const params = new URLSearchParams({
      order_id: orderId,
      restaurant_token: this.restaurantToken,
      customer_name: orderData.customerName,
      customer_phone: orderData.phone,
      order_type: orderData.orderType,
      total: total.toFixed(2),
      // Encode items as JSON in query param
      items: JSON.stringify(orderData.items),
    });

    if (orderData.email) {
      params.append('customer_email', orderData.email);
    }
    if (orderData.deliveryAddress) {
      params.append('delivery_address', orderData.deliveryAddress);
    }
    if (orderData.specialInstructions) {
      params.append('special_instructions', orderData.specialInstructions);
    }

    // Get restaurant subdomain from token or use default
    // This would need to be configured per restaurant
    const restaurantSubdomain = this.getRestaurantSubdomain();
    const checkoutUrl = `https://${restaurantSubdomain}.gloriafood.com/checkout?${params.toString()}`;

    return {
      orderId,
      checkoutUrl,
      total,
      estimatedReadyTime: this.estimateReadyTime(orderData.items),
      items: orderData.items,
    };
  }

  /**
   * Get order status from Gloria Foods
   */
  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/orders/${orderId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.restaurantToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch order status: ${response.status}`);
      }

      const data = await response.json();
      
      return {
        orderId: data.order_id || orderId,
        status: this.mapOrderStatus(data.status),
        estimatedReadyTime: data.estimated_ready_time,
        actualReadyTime: data.actual_ready_time,
      };
    } catch (error) {
      console.error('Error fetching order status:', error);
      throw new Error('Failed to fetch order status');
    }
  }

  /**
   * Map Gloria Foods order status to our status enum
   */
  private mapOrderStatus(status: string): OrderStatus['status'] {
    const statusMap: Record<string, OrderStatus['status']> = {
      'pending': 'PENDING',
      'confirmed': 'CONFIRMED',
      'preparing': 'PREPARING',
      'ready': 'READY',
      'completed': 'COMPLETED',
      'cancelled': 'CANCELLED',
    };
    
    return statusMap[status.toLowerCase()] || 'PENDING';
  }

  /**
   * Generate a temporary order ID
   */
  private generateOrderId(): string {
    return `menyo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Estimate ready time based on order items
   */
  private estimateReadyTime(items: OrderItem[]): string {
    // Simple estimation: 15 minutes base + 5 minutes per item
    const baseMinutes = 15;
    const perItemMinutes = 5;
    const totalMinutes = baseMinutes + (items.length * perItemMinutes);
    
    const readyTime = new Date();
    readyTime.setMinutes(readyTime.getMinutes() + totalMinutes);
    
    return readyTime.toISOString();
  }

  /**
   * Get restaurant subdomain from token or configuration
   * This would typically be stored in restaurant profile
   */
  private getRestaurantSubdomain(): string {
    // For now, return a placeholder
    // This should be stored in RestaurantProfile when connecting Gloria Foods
    return 'restaurant'; // Would be replaced with actual subdomain
  }
}

// Export singleton helper (similar to geminiService pattern)
// Note: This will be instantiated per-tenant with their restaurant token
export function createGloriaFoodsService(restaurantToken: string, masterKey?: string): GloriaFoodsService {
  return new GloriaFoodsService(restaurantToken, masterKey);
}

