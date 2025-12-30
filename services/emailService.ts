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
   * Send email-only order (primary delivery, not just notification)
   * For Path A (Email-Only) mode
   */
  async sendEmailOnlyOrder(
    ownerEmail: string,
    orderDetails: {
      orderId: string;
      customerName: string;
      phone: string;
      email?: string;
      items: Array<{ itemName: string; quantity: number; description?: string }>;
      orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY';
      deliveryAddress?: string;
      specialInstructions?: string;
      timestamp: string;
    }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const itemsList = orderDetails.items
      .map(item => {
        const description = item.description ? ` (${item.description})` : '';
        return `  • ${item.itemName} x${item.quantity}${description}`;
      })
      .join('\n');

    const orderTypeDisplay = orderDetails.orderType === 'DINE_IN' ? 'Dine-In'
      : orderDetails.orderType === 'PICKUP' ? 'Pickup'
      : 'Delivery';

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .badge { background: #065f46; color: white; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; display: inline-block; margin-top: 10px; }
            .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
            .order-details { background: white; padding: 20px; border-radius: 4px; margin: 15px 0; border-left: 4px solid #10b981; }
            .order-id { font-size: 24px; font-weight: bold; color: #10b981; margin-bottom: 20px; }
            .section { margin: 20px 0; padding: 15px 0; border-bottom: 1px solid #e5e7eb; }
            .section:last-child { border-bottom: none; }
            .section h3 { color: #10b981; margin-top: 0; margin-bottom: 10px; font-size: 16px; }
            .info-row { margin: 8px 0; }
            .label { font-weight: bold; color: #64748b; display: inline-block; min-width: 120px; }
            .items { background: #f9fafb; padding: 15px; border-radius: 4px; margin: 10px 0; }
            .items pre { margin: 0; font-family: Arial, sans-serif; white-space: pre-wrap; line-height: 1.8; }
            .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 15px 0; border-radius: 4px; }
            .alert strong { color: #92400e; }
            .cta { background: #10b981; color: white; padding: 15px 30px; text-align: center; border-radius: 4px; margin: 20px 0; font-weight: bold; font-size: 16px; }
            .footer { color: #6b7280; font-size: 14px; margin-top: 20px; text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">New Order Received!</h1>
              <div class="badge">EMAIL ORDER - NO PAYMENT REQUIRED</div>
            </div>
            <div class="content">
              <div class="order-details">
                <div class="order-id">Order #${orderDetails.orderId}</div>

                <div class="section">
                  <h3>Customer Information</h3>
                  <div class="info-row">
                    <span class="label">Name:</span>
                    <span>${orderDetails.customerName}</span>
                  </div>
                  <div class="info-row">
                    <span class="label">Phone:</span>
                    <span><strong>${orderDetails.phone}</strong></span>
                  </div>
                  ${orderDetails.email ? `
                  <div class="info-row">
                    <span class="label">Email:</span>
                    <span>${orderDetails.email}</span>
                  </div>
                  ` : ''}
                </div>

                <div class="section">
                  <h3>Order Details</h3>
                  <div class="info-row">
                    <span class="label">Order Type:</span>
                    <span><strong>${orderTypeDisplay}</strong></span>
                  </div>
                  ${orderDetails.deliveryAddress ? `
                  <div class="info-row">
                    <span class="label">Delivery Address:</span>
                    <span>${orderDetails.deliveryAddress}</span>
                  </div>
                  ` : ''}
                  <div class="info-row">
                    <span class="label">Time Received:</span>
                    <span>${new Date(orderDetails.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                <div class="section">
                  <h3>Items Ordered</h3>
                  <div class="items">
                    <pre>${itemsList}</pre>
                  </div>
                </div>

                ${orderDetails.specialInstructions ? `
                <div class="section">
                  <h3>Special Instructions</h3>
                  <p style="margin: 0; font-style: italic;">${orderDetails.specialInstructions}</p>
                </div>
                ` : ''}
              </div>

              <div class="alert">
                <strong>⚠️ Action Required:</strong> This is an email-only order with no online payment.
                Please contact the customer at <strong>${orderDetails.phone}</strong> to confirm the order and arrange payment.
              </div>

              <div class="cta">
                Contact Customer: ${orderDetails.phone}
              </div>

              <div class="footer">
                This is an automated email from menyo! AI ordering system.
                <br>
                Email-Only Mode - No payment processing included.
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.sendEmail({
      to: ownerEmail,
      subject: `[MENYO ORDER] New ${orderTypeDisplay} Order from ${orderDetails.customerName}`,
      html,
    });
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

  /**
   * Send email-only reservation (primary delivery, not just notification)
   * For Path A (Email-Only) mode
   */
  async sendEmailOnlyReservation(
    ownerEmail: string,
    reservationDetails: {
      reservationId: string;
      customerName: string;
      phone: string;
      email?: string;
      date: string;
      time: string;
      partySize: number;
      specialRequests?: string;
      timestamp: string;
    }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .badge { background: #065f46; color: white; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; display: inline-block; margin-top: 10px; }
            .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
            .reservation-details { background: white; padding: 20px; border-radius: 4px; margin: 15px 0; border-left: 4px solid #10b981; }
            .reservation-id { font-size: 24px; font-weight: bold; color: #10b981; margin-bottom: 20px; }
            .section { margin: 20px 0; padding: 15px 0; border-bottom: 1px solid #e5e7eb; }
            .section:last-child { border-bottom: none; }
            .section h3 { color: #10b981; margin-top: 0; margin-bottom: 10px; font-size: 16px; }
            .info-row { margin: 8px 0; }
            .label { font-weight: bold; color: #64748b; display: inline-block; min-width: 120px; }
            .highlight { background: #f0fdf4; padding: 15px; border-radius: 4px; margin: 10px 0; border-left: 3px solid #10b981; }
            .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 15px 0; border-radius: 4px; }
            .alert strong { color: #92400e; }
            .cta { background: #10b981; color: white; padding: 15px 30px; text-align: center; border-radius: 4px; margin: 20px 0; font-weight: bold; font-size: 16px; }
            .footer { color: #6b7280; font-size: 14px; margin-top: 20px; text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">New Reservation Request!</h1>
              <div class="badge">EMAIL RESERVATION - CONFIRMATION REQUIRED</div>
            </div>
            <div class="content">
              <div class="reservation-details">
                <div class="reservation-id">Reservation #${reservationDetails.reservationId}</div>

                <div class="section">
                  <h3>Customer Information</h3>
                  <div class="info-row">
                    <span class="label">Name:</span>
                    <span>${reservationDetails.customerName}</span>
                  </div>
                  <div class="info-row">
                    <span class="label">Phone:</span>
                    <span><strong>${reservationDetails.phone}</strong></span>
                  </div>
                  ${reservationDetails.email ? `
                  <div class="info-row">
                    <span class="label">Email:</span>
                    <span>${reservationDetails.email}</span>
                  </div>
                  ` : ''}
                </div>

                <div class="section">
                  <h3>Reservation Details</h3>
                  <div class="highlight">
                    <div class="info-row">
                      <span class="label">Date:</span>
                      <span><strong>${new Date(reservationDetails.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</strong></span>
                    </div>
                    <div class="info-row">
                      <span class="label">Time:</span>
                      <span><strong>${reservationDetails.time}</strong></span>
                    </div>
                    <div class="info-row">
                      <span class="label">Party Size:</span>
                      <span><strong>${reservationDetails.partySize} ${reservationDetails.partySize === 1 ? 'guest' : 'guests'}</strong></span>
                    </div>
                  </div>
                  <div class="info-row">
                    <span class="label">Request Received:</span>
                    <span>${new Date(reservationDetails.timestamp).toLocaleString()}</span>
                  </div>
                </div>

                ${reservationDetails.specialRequests ? `
                <div class="section">
                  <h3>Special Requests</h3>
                  <p style="margin: 0; font-style: italic;">${reservationDetails.specialRequests}</p>
                </div>
                ` : ''}
              </div>

              <div class="alert">
                <strong>⚠️ Action Required:</strong> This is a reservation request that requires confirmation.
                Please contact the customer at <strong>${reservationDetails.phone}</strong> to confirm availability and finalize the reservation.
              </div>

              <div class="cta">
                Contact Customer: ${reservationDetails.phone}
              </div>

              <div class="footer">
                This is an automated email from menyo! AI ordering system.
                <br>
                Email-Only Mode - Manual confirmation required.
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.sendEmail({
      to: ownerEmail,
      subject: `[MENYO RESERVATION] ${reservationDetails.partySize} guests on ${new Date(reservationDetails.date).toLocaleDateString()} at ${reservationDetails.time}`,
      html,
    });
  }
}

// Export singleton instance
export function createEmailService(): EmailService {
  return new EmailService();
}
