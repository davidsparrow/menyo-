// Menu Helper Functions
// Provides filtering and search capabilities for menu items

import type { GloriaFoodsMenu, GloriaFoodsMenuItem } from '../services/gloriaFoodsService';

export interface MenuFilter {
  category?: string;
  dietaryRestrictions?: string[]; // e.g., ["gluten-free", "vegetarian", "vegan"]
  maxPrice?: number;
  minPrice?: number;
  keywords?: string[]; // Search in name/description
}

/**
 * Filter menu items based on criteria
 */
export function filterMenuItems(
  menu: GloriaFoodsMenu | null,
  filters: MenuFilter,
  limit: number = 6
): GloriaFoodsMenuItem[] {
  if (!menu) return [];

  let items: GloriaFoodsMenuItem[] = [];

  // Collect all items from categories
  menu.categories.forEach(category => {
    if (!filters.category || category.name.toLowerCase().includes(filters.category.toLowerCase())) {
      items.push(...category.items);
    }
  });

  // Filter by dietary restrictions (keyword matching in name/description)
  if (filters.dietaryRestrictions && filters.dietaryRestrictions.length > 0) {
    const restrictions = filters.dietaryRestrictions.map(r => r.toLowerCase());
    items = items.filter(item => {
      const nameLower = item.name.toLowerCase();
      const descLower = (item.description || '').toLowerCase();
      const text = `${nameLower} ${descLower}`;
      
      // Check if any restriction keyword appears in the item
      return restrictions.some(restriction => {
        const keywords = restriction.split(/[-_\s]+/);
        return keywords.some(keyword => text.includes(keyword));
      });
    });
  }

  // Filter by price range
  if (filters.minPrice !== undefined) {
    items = items.filter(item => item.price >= filters.minPrice!);
  }
  if (filters.maxPrice !== undefined) {
    items = items.filter(item => item.price <= filters.maxPrice!);
  }

  // Filter by keywords
  if (filters.keywords && filters.keywords.length > 0) {
    const keywords = filters.keywords.map(k => k.toLowerCase());
    items = items.filter(item => {
      const nameLower = item.name.toLowerCase();
      const descLower = (item.description || '').toLowerCase();
      const text = `${nameLower} ${descLower}`;
      return keywords.some(keyword => text.includes(keyword));
    });
  }

  // Filter available items only
  items = items.filter(item => item.available);

  // Limit results
  return items.slice(0, limit);
}

/**
 * Get a specific menu item by ID
 */
export function getMenuItemById(
  menu: GloriaFoodsMenu | null,
  itemId: string
): GloriaFoodsMenuItem | null {
  if (!menu) return null;

  for (const category of menu.categories) {
    const item = category.items.find(i => i.id === itemId);
    if (item) return item;
  }

  return null;
}

/**
 * Search menu items by name or description
 */
export function searchMenuItems(
  menu: GloriaFoodsMenu | null,
  query: string,
  limit: number = 6
): GloriaFoodsMenuItem[] {
  if (!menu || !query) return [];

  const queryLower = query.toLowerCase();
  const results: GloriaFoodsMenuItem[] = [];

  for (const category of menu.categories) {
    for (const item of category.items) {
      if (!item.available) continue;

      const nameMatch = item.name.toLowerCase().includes(queryLower);
      const descMatch = item.description?.toLowerCase().includes(queryLower);

      if (nameMatch || descMatch) {
        results.push(item);
        if (results.length >= limit) break;
      }
    }
    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Get all categories from menu
 */
export function getCategories(menu: GloriaFoodsMenu | null): string[] {
  if (!menu) return [];
  return menu.categories.map(cat => cat.name);
}

/**
 * Get items by category
 */
export function getItemsByCategory(
  menu: GloriaFoodsMenu | null,
  categoryName: string
): GloriaFoodsMenuItem[] {
  if (!menu) return [];

  const category = menu.categories.find(
    cat => cat.name.toLowerCase() === categoryName.toLowerCase()
  );

  return category ? category.items.filter(item => item.available) : [];
}
