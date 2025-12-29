// Email Service using Resend
// Handles sending email notifications to restaurant owners

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export class EmailService {
  private apiKey: string;
  private fromEmail: string;

  constructor(apiKey?: string, fromEmail?: string) {
    this.apiKey = apiKey || process.env.RESEND_API_KEY || '';
    this.fromEmail = fromEmail || process.env.RESEND_FROM_EMAIL || 'noreply@menyo.app';
    
    if (!this.apiKey) {
      console.warn('Resend API key not configured. Email notifications will be disabled.');
    }
  }

  /**
   * Send email using Resend API
   */
  async sendEmail(options: EmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.apiKey) {
      return { success: false, error: 'Resend API key not configured' };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from || this.fromEmail,
          to: options.to,
          subject: options.subject,
          html: options.html,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Resend API error: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, messageId: data.id };
    } catch (error: any) {
      console.error('Error sending email:', error);
      return { success: false, error: error.message || 'Failed to send email' };
    }
  }

  /**
   * Send order notification email to restaurant owner
   */
  async sendOrderNotification(
    ownerEmail: string,
    orderDetails: {
      orderId: string;
      customerName: string;
      phone?: string;
      email?: string;
      items: Array<{ itemName: string; quantity: number; price: number }>;
      total: number;
      orderType: string;
      estimatedReadyTime?: string;
      specialInstructions?: string;
    }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const itemsList = orderDetails.items
      .map(item => `  • ${item.itemName} x${item.quantity} - $${(item.price * item.quantity).toFixed(2)}`)
      .join('\n');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #0ea5e9; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
            .order-details { background: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .order-id { font-size: 24px; font-weight: bold; color: #0ea5e9; }
            .item { padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
            .total { font-size: 18px; font-weight: bold; margin-top: 15px; padding-top: 15px; border-top: 2px solid #0ea5e9; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>New Order Received!</h1>
            </div>
            <div class="content">
              <div class="order-details">
              <div class="order-id">Order #${orderDetails.orderId}</div>
              
              <h3>Customer Information</h3>
              <p><strong>Name:</strong> ${orderDetails.customerName}</p>
              ${orderDetails.phone ? `<p><strong>Phone:</strong> ${orderDetails.phone}</p>` : ''}
              ${orderDetails.email ? `<p><strong>Email:</strong> ${orderDetails.email}</p>` : ''}
              
              <h3>Order Details</h3>
              <p><strong>Type:</strong> ${orderDetails.orderType}</p>
              ${orderDetails.estimatedReadyTime ? `<p><strong>Estimated Ready Time:</strong> ${new Date(orderDetails.estimatedReadyTime).toLocaleString()}</p>` : ''}
              
              <h3>Items</h3>
              <pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${itemsList}</pre>
              
              <div class="total">Total: $${orderDetails.total.toFixed(2)}</div>
              
              ${orderDetails.specialInstructions ? `<h3>Special Instructions</h3><p>${orderDetails.specialInstructions}</p>` : ''}
              </div>
              
              <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
                This is an automated notification from menyo! AI ordering system.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.sendEmail({
      to: ownerEmail,
      subject: `New Order #${orderDetails.orderId} - ${orderDetails.customerName}`,
      html,
    });
  }
}

// Export singleton instance
export function createEmailService(): EmailService {
  return new EmailService();
}
