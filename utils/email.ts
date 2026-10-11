// Email utility using Resend
// To enable emails, install resend: npm install resend
// Add RESEND_API_KEY to your .env.local file

import { NATIONALS_CONFIG } from "../app/config/nationals";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

// Mailbox providers score "no-reply" senders down (Resend flags it too), so the
// default From is a plain address and replies are routed to a person. The
// domain has no inbound mail, so reply_to is what actually reaches anyone.
const DEFAULT_FROM = "Land of Redemption <hello@landofredemption.com>";
const DEFAULT_REPLY_TO = "landofredemption@gmail.com";

export async function sendEmail({ to, subject, html, from, replyTo }: EmailOptions) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = from ?? (process.env.FROM_EMAIL || DEFAULT_FROM);
  const replyToEmail = replyTo ?? DEFAULT_REPLY_TO;

  if (!resendApiKey) {
    console.warn("RESEND_API_KEY not configured. Email not sent.");
    return { success: false, error: "Email service not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to,
        subject,
        html,
        reply_to: replyToEmail,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Email send failed:", error);
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    console.error("Email send error:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Wraps arbitrary HTML content in a branded email template with the logo,
 * header, and footer. Used for bulk emails sent from the admin panel.
 */
export function wrapEmailInTemplate(bodyHtml: string): string {
  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || "https://landofredemption.com";

  const logoUrl = `${baseUrl}/darkmode_redemptionccgapp.png`;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;padding:0;background-color:#111113;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#111113;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#1a1a1e;border-radius:12px;overflow:hidden;">
            <!-- Logo header -->
            <tr>
              <td align="center" style="padding:32px 30px 24px 30px;border-bottom:1px solid #2a2a2e;">
                <img src="${logoUrl}" alt="Redemption CCG App" width="200" style="display:block;max-width:200px;height:auto;" />
              </td>
            </tr>
            <!-- Body content -->
            <tr>
              <td style="padding:32px 30px;color:#e4e4e7;font-size:16px;line-height:1.7;">
                ${bodyHtml}
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:24px 30px;border-top:1px solid #2a2a2e;text-align:center;">
                <p style="margin:0 0 4px 0;color:#71717a;font-size:13px;">${NATIONALS_CONFIG.displayName} &bull; ${NATIONALS_CONFIG.dates}</p>
                <p style="margin:0;color:#71717a;font-size:13px;">
                  <a href="https://landofredemption.com" style="color:#a1a1aa;text-decoration:none;">landofredemption.com</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function getRegistrationConfirmationEmail(
  firstName: string,
  lastName: string,
  thursdayEvent: string,
  fridayEvent: string,
  saturdayEvent: string
) {
  const formatEvent = (event: string) => {
    if (!event || event === "none") return "None";
    return event
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Function to get event price
  const getEventPrice = (eventValue: string, day: 'thursday' | 'friday' | 'saturday'): number => {
    const event = NATIONALS_CONFIG.events[day].find(e => e.value === eventValue);
    if (!event || !event.price) return 0;
    // Extract number from price string like "$35"
    return parseFloat(event.price.replace('$', ''));
  };

  // Calculate total payment
  const thursdayPrice = getEventPrice(thursdayEvent, 'thursday');
  const fridayPrice = getEventPrice(fridayEvent, 'friday');
  const saturdayPrice = getEventPrice(saturdayEvent, 'saturday');
  const totalPayment = thursdayPrice + fridayPrice + saturdayPrice;

  // Format event with price
  const formatEventWithPrice = (eventValue: string, day: 'thursday' | 'friday' | 'saturday') => {
    const event = NATIONALS_CONFIG.events[day].find(e => e.value === eventValue);
    if (!event || event.value === 'none') return 'None';
    const eventName = formatEvent(eventValue);
    return event.price ? `${eventName} - ${event.price}` : eventName;
  };

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6; 
            color: #1f2937; 
            background-color: #f3f4f6;
            margin: 0;
            padding: 0;
          }
          .container { 
            max-width: 600px; 
            margin: 40px auto; 
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header { 
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white; 
            padding: 40px 30px; 
            text-align: center;
          }
          .header h1 { 
            margin: 0 0 10px 0; 
            font-size: 32px; 
            font-weight: 700;
          }
          .header p { 
            margin: 0; 
            font-size: 18px; 
            opacity: 0.95;
          }
          .checkmark {
            display: inline-block;
            width: 60px;
            height: 60px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            margin: 0 0 20px 0;
            position: relative;
          }
          .checkmark:after {
            content: '✓';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 36px;
            color: white;
            font-weight: bold;
          }
          .content { 
            padding: 40px 30px;
          }
          .greeting {
            font-size: 24px;
            font-weight: 600;
            color: #111827;
            margin: 0 0 20px 0;
          }
          .intro-text {
            font-size: 16px;
            color: #4b5563;
            margin: 0 0 30px 0;
          }
          .section-title {
            font-size: 18px;
            font-weight: 600;
            color: #111827;
            margin: 30px 0 15px 0;
          }
          .event-box { 
            background: #f9fafb;
            padding: 16px 20px; 
            margin: 12px 0; 
            border-left: 4px solid #10b981; 
            border-radius: 6px;
          }
          .event-box strong {
            display: block;
            color: #374151;
            font-size: 14px;
            margin-bottom: 4px;
          }
          .event-box span {
            color: #059669;
            font-size: 16px;
            font-weight: 500;
          }
          .payment-box {
            background: #f0f9ff;
            border: 2px solid #3b82f6;
            border-radius: 8px;
            padding: 24px;
            margin: 30px 0;
          }
          .payment-box h3 {
            margin: 0 0 16px 0;
            color: #1e40af;
            font-size: 20px;
            font-weight: 700;
            text-align: center;
          }
          .payment-breakdown {
            background: white;
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 16px;
          }
          .payment-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #e5e7eb;
          }
          .payment-item:last-child {
            border-bottom: none;
          }
          .payment-item-label {
            color: #4b5563;
            font-size: 14px;
          }
          .payment-item-price {
            color: #1f2937;
            font-weight: 600;
            font-size: 14px;
          }
          .payment-total {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px;
            background: white;
            border-radius: 6px;
            border: 2px solid #3b82f6;
          }
          .payment-total-label {
            color: #1e40af;
            font-size: 18px;
            font-weight: 700;
          }
          .payment-total-amount {
            color: #1e40af;
            font-size: 24px;
            font-weight: 700;
          }
          .info-box {
            background: #ecfdf5;
            border: 1px solid #a7f3d0;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
          }
          .info-box h4 {
            margin: 0 0 12px 0;
            color: #065f46;
            font-size: 16px;
            font-weight: 600;
          }
          .info-box ul {
            margin: 0;
            padding: 0 0 0 20px;
            color: #047857;
          }
          .info-box li {
            margin: 6px 0;
          }
          .contact-box {
            background: #fef3c7;
            border: 1px solid #fde68a;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
          }
          .contact-box p {
            margin: 0 0 12px 0;
            color: #92400e;
            font-weight: 500;
          }
          .contact-box a {
            color: #b45309;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
          }
          .contact-box a:hover {
            text-decoration: underline;
          }
          .footer { 
            text-align: center; 
            padding: 30px; 
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
          }
          .footer p {
            margin: 5px 0;
            color: #6b7280; 
            font-size: 14px;
          }
          .footer a {
            color: #10b981;
            text-decoration: none;
          }
          @media only screen and (max-width: 600px) {
            .container {
              margin: 0;
              border-radius: 0;
            }
            .content {
              padding: 30px 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="checkmark"></div>
            <h1>You're Registered!</h1>
            <p>${NATIONALS_CONFIG.displayName} • ${NATIONALS_CONFIG.datesShort}</p>
          </div>
          
          <div class="content">
            <p class="greeting">Hey ${firstName} ${lastName}! 🎉</p>
            <p class="intro-text">
              Your registration for the ${NATIONALS_CONFIG.year} National Redemption Tournament is confirmed! 
              We're excited to see you compete this summer.
            </p>
            
            <h3 class="section-title">📅 Your Event Schedule</h3>
            
            <div class="event-box">
              <strong>Thursday, ${NATIONALS_CONFIG.eventDates.thursday}</strong>
              <span>${formatEventWithPrice(thursdayEvent, 'thursday')}</span>
            </div>
            
            <div class="event-box">
              <strong>Friday, ${NATIONALS_CONFIG.eventDates.friday}</strong>
              <span>${formatEventWithPrice(fridayEvent, 'friday')}</span>
            </div>
            
            <div class="event-box">
              <strong>Saturday, ${NATIONALS_CONFIG.eventDates.saturday}</strong>
              <span>${formatEventWithPrice(saturdayEvent, 'saturday')}</span>
            </div>
            
            ${totalPayment > 0 ? `
            <div class="payment-box">
              <h3>💵 Payment Summary</h3>
              <div class="payment-breakdown">
                ${thursdayPrice > 0 ? `
                <div class="payment-item">
                  <span class="payment-item-label">Thursday: ${formatEvent(thursdayEvent)} $${thursdayPrice.toFixed(2)}</span>
                </div>
                ` : ''}
                ${fridayPrice > 0 ? `
                <div class="payment-item">
                  <span class="payment-item-label">Friday: ${formatEvent(fridayEvent)} $${fridayPrice.toFixed(2)}</span>
                </div>
                ` : ''}
                ${saturdayPrice > 0 ? `
                <div class="payment-item">
                  <span class="payment-item-label">Saturday: ${formatEvent(saturdayEvent)} $${saturdayPrice.toFixed(2)}</span>
                </div>
                ` : ''}
              </div>
              <div class="payment-total">
                <span class="payment-total-label">Total Due Upon Arrival: </span>
                <span class="payment-total-amount">$${totalPayment.toFixed(2)}</span>
              </div>
            </div>
            ` : ''}
            
            <div class="info-box">
              <h4>📍 What's Next?</h4>
              <ul>
                <li>Venue location and directions will be sent in the coming weeks</li>
                <li>Detailed tournament schedule and rules coming soon</li>
                <li>Hotel recommendations and group rates will be shared</li>
              </ul>
            </div>
            
            <div class="contact-box">
              <p>Questions or need to update your registration?</p>
              <a href="mailto:Brianjones121191@gmail.com">Brianjones121191@gmail.com</a>
            </div>
            
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              This email confirms your registration. Please keep it for your records.
            </p>
          </div>
          
          <div class="footer">
            <p><strong>Land of Redemption</strong></p>
            <p>${NATIONALS_CONFIG.displayName} Tournament | ${NATIONALS_CONFIG.dates}</p>
            <p style="margin-top: 10px;">
              <a href="https://landofredemption.com">Visit our website</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}
