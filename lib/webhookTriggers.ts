// Webhook Trigger Library
// Triggers Make.com/n8n webhooks when events occur

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export type WebhookEventType = 'reservation.created' | 'reservation.updated' | 'reservation.cancelled' | 'order.created' | 'order.updated';

/**
 * Trigger webhook subscriptions for an event
 */
export async function triggerWebhookSubscriptions(
  restaurantId: string,
  tenantId: string,
  eventType: WebhookEventType,
  payload: any
): Promise<void> {
  try {
    // Get active webhook subscriptions for this restaurant
    const { data: subscriptions } = await supabase
      .from('webhook_subscriptions')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true);

    if (!subscriptions || subscriptions.length === 0) {
      return; // No subscriptions
    }

    // Filter subscriptions that match this event type
    const matchingSubscriptions = subscriptions.filter(sub => 
      sub.event_types.includes(eventType)
    );

    // Trigger each webhook
    const promises = matchingSubscriptions.map(async (subscription) => {
      try {
        const response = await fetch(subscription.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${subscription.secret_token}`,
            'X-Webhook-Event': eventType,
          },
          body: JSON.stringify({
            event: eventType,
            timestamp: new Date().toISOString(),
            restaurant_id: restaurantId,
            tenant_id: tenantId,
            ...payload,
          }),
        });

        if (!response.ok) {
          console.error(`Webhook failed for ${subscription.webhook_url}: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        console.error(`Error triggering webhook ${subscription.webhook_url}:`, error);
      }
    });

    await Promise.allSettled(promises);
  } catch (error) {
    console.error('Error triggering webhook subscriptions:', error);
    // Don't throw - webhook failures shouldn't break the main flow
  }
}
