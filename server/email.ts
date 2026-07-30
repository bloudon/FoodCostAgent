import nodemailer from "nodemailer";

function createTransport() {
  const user = process.env.SMTP2GO_USERNAME;
  const pass = process.env.SMTP2GO_PASSWORD;
  const host = process.env.SMTP2GO_HOST || "mail.smtp2go.com";
  const port = parseInt(process.env.SMTP2GO_PORT || "587", 10);

  if (!user || !pass) {
    console.warn("[Email] SMTP2GO credentials not configured — emails will be skipped");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const FROM_EMAIL = process.env.SMTP_FROM_EMAIL || "no-reply@fnbcostpro.com";
const FROM_NAME = process.env.SMTP_FROM_NAME || "FNB Cost Pro";

export async function sendOtpEmail(opts: {
  to: string;
  firstName: string;
  otp: string;
}) {
  const transport = createTransport();
  if (!transport) {
    console.warn("[Email] Skipping OTP email — no transport configured");
    return;
  }

  const { to, firstName, otp } = opts;

  try {
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject: "Your FNB Cost Pro verification code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e293b; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">
              <span style="color: #ffffff;">FNB</span>
              <span style="color: #22c55e; font-size: 16px;"> cost pro</span>
            </h1>
          </div>
          <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1e293b;">Hi ${firstName},</h2>
            <p style="color: #475569; line-height: 1.6;">
              Use the verification code below to confirm your email address.
              This code expires in <strong>15 minutes</strong>.
            </p>
            <div style="margin: 32px 0; text-align: center;">
              <div style="display: inline-block; background: #f1f5f9; border: 2px solid #e2e8f0;
                          border-radius: 8px; padding: 20px 40px;">
                <span style="font-size: 40px; font-weight: bold; letter-spacing: 12px; color: #1e293b;">
                  ${otp}
                </span>
              </div>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">
              If you didn't request this, you can safely ignore this email.
            </p>
          </div>
          <div style="background: #f1f5f9; padding: 16px; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} FNB Cost Pro. All rights reserved.
            </p>
          </div>
        </div>
      `,
      text: `Hi ${firstName},\n\nYour FNB Cost Pro verification code is: ${otp}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, please ignore this email.`,
    });
    console.log(`[Email] OTP email sent to ${to}`);
  } catch (err) {
    console.error("[Email] Failed to send OTP email:", err);
    throw err;
  }
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  firstName: string;
  resetUrl: string;
}) {
  const transport = createTransport();
  if (!transport) {
    console.warn("[Email] Skipping password reset email — no transport configured");
    return;
  }

  const { to, firstName, resetUrl } = opts;

  try {
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject: "Reset your FNB Cost Pro password",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e293b; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">
              <span style="color: #ffffff;">FNB</span>
              <span style="color: #22c55e; font-size: 16px;"> cost pro</span>
            </h1>
          </div>
          <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1e293b;">Hi ${firstName},</h2>
            <p style="color: #475569; line-height: 1.6;">
              We received a request to reset your password. Click the button below to choose a new one.
              This link expires in <strong>1 hour</strong>.
            </p>
            <div style="margin: 32px 0; text-align: center;">
              <a href="${resetUrl}"
                 style="background: #f2690d; color: #ffffff; padding: 14px 32px;
                        border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
                Reset Password
              </a>
            </div>
            <p style="color: #475569; line-height: 1.6;">
              Or copy this link into your browser:<br/>
              <a href="${resetUrl}" style="color: #f2690d; word-break: break-all;">${resetUrl}</a>
            </p>
            <p style="color: #94a3b8; font-size: 13px;">
              If you didn't request a password reset, you can safely ignore this email.
              Your password will not change.
            </p>
          </div>
          <div style="background: #f1f5f9; padding: 16px; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} FNB Cost Pro. All rights reserved.
            </p>
          </div>
        </div>
      `,
      text: `Hi ${firstName},\n\nReset your FNB Cost Pro password by visiting:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, ignore this email.`,
    });
    console.log(`[Email] Password reset email sent to ${to}`);
  } catch (err) {
    console.error("[Email] Failed to send password reset email:", err);
  }
}

export async function sendInvitationEmail(opts: {
  to: string;
  inviterName: string;
  companyName: string;
  role: string;
  inviteUrl: string;
}) {
  const transport = createTransport();
  if (!transport) {
    console.warn("[Email] Skipping invitation email — no transport configured");
    return;
  }

  const { to, inviterName, companyName, role, inviteUrl } = opts;

  const roleLabel: Record<string, string> = {
    company_admin: "Company Admin",
    store_manager: "Store Manager",
    store_user: "Store Member",
  };
  const roleName = roleLabel[role] || role;

  try {
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject: `You've been invited to join ${companyName} on FNB Cost Pro`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e293b; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">
              <span style="color: #ffffff;">FNB</span>
              <span style="color: #22c55e; font-size: 16px;"> cost pro</span>
            </h1>
          </div>
          <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1e293b;">You're invited!</h2>
            <p style="color: #475569; line-height: 1.6;">
              <strong>${inviterName}</strong> has invited you to join <strong>${companyName}</strong>
              on FNB Cost Pro as a <strong>${roleName}</strong>.
            </p>
            <p style="color: #475569; line-height: 1.6;">
              Click the button below to create your account and get started.
              This invitation expires in <strong>7 days</strong>.
            </p>
            <div style="margin: 32px 0; text-align: center;">
              <a href="${inviteUrl}"
                 style="background: #f2690d; color: #ffffff; padding: 14px 32px;
                        border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px;">
                Accept Invitation
              </a>
            </div>
            <p style="color: #475569; line-height: 1.6;">
              Or copy this link into your browser:<br/>
              <a href="${inviteUrl}" style="color: #f2690d; word-break: break-all;">${inviteUrl}</a>
            </p>
            <p style="color: #94a3b8; font-size: 13px;">
              If you weren't expecting this invitation, you can safely ignore this email.
            </p>
          </div>
          <div style="background: #f1f5f9; padding: 16px; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} FNB Cost Pro. All rights reserved.
            </p>
          </div>
        </div>
      `,
      text: `You've been invited to join ${companyName} on FNB Cost Pro as a ${roleName}.\n\nAccept your invitation here:\n${inviteUrl}\n\nThis invitation expires in 7 days.\n\nIf you weren't expecting this, ignore this email.`,
    });
    console.log(`[Email] Invitation email sent to ${to}`);
  } catch (err) {
    console.error("[Email] Failed to send invitation email:", err);
  }
}

export async function sendWelcomeEmail(opts: {
  to: string;
  firstName: string;
  companyName: string;
}) {
  const transport = createTransport();
  if (!transport) return;

  const { to, firstName, companyName } = opts;

  try {
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject: "Welcome to FNB Cost Pro!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e293b; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">
              <span style="color: #ffffff;">FNB</span>
              <span style="color: #22c55e; font-size: 16px;"> cost pro</span>
            </h1>
          </div>
          <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1e293b;">Welcome, ${firstName}!</h2>
            <p style="color: #475569; line-height: 1.6;">
              Your account for <strong>${companyName}</strong> has been created successfully.
              You're now set up and ready to start managing your food costs.
            </p>
            <p style="color: #475569; line-height: 1.6;">
              Log in at any time to continue setting up your store locations,
              inventory, and recipes.
            </p>
            <div style="margin: 32px 0; text-align: center;">
              <a href="https://app.fnbcostpro.com" 
                 style="background: #f2690d; color: #ffffff; padding: 12px 28px; 
                        border-radius: 6px; text-decoration: none; font-weight: bold;">
                Go to FNB Cost Pro
              </a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">
              If you have any questions, reply to this email or contact our support team.
            </p>
          </div>
          <div style="background: #f1f5f9; padding: 16px; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} FNB Cost Pro. All rights reserved.
            </p>
          </div>
        </div>
      `,
      text: `Welcome to FNB Cost Pro, ${firstName}!\n\nYour account for ${companyName} has been created. Visit https://app.fnbcostpro.com to get started.`,
    });
    console.log(`[Email] Welcome email sent to ${to}`);
  } catch (err) {
    console.error("[Email] Failed to send welcome email:", err);
  }
}

export async function sendImportSummaryEmail(opts: {
  to: string;
  firstName: string;
  fileName: string;
  vendorName: string | null;
  vendorItemsCreated: number;
  inventoryItemsCreated: number;
  suspiciousLines: Array<{ productName: string; caseSize: number | null; nameCount: number | null }>;
}) {
  const transport = createTransport();
  if (!transport) {
    console.warn("[Email] Skipping import summary email — no transport configured");
    return;
  }

  const { to, firstName, fileName, vendorName, vendorItemsCreated, inventoryItemsCreated, suspiciousLines } = opts;
  const totalImported = vendorItemsCreated + inventoryItemsCreated;

  const suspiciousRowsHtml = suspiciousLines.length > 0 ? `
    <div style="margin-top: 24px;">
      <h3 style="color: #92400e; font-size: 15px; margin: 0 0 8px 0;">
        &#9888;&#xFE0F; ${suspiciousLines.length} Pack-Size ${suspiciousLines.length === 1 ? 'Warning' : 'Warnings'}
      </h3>
      <p style="color: #475569; font-size: 13px; margin: 0 0 12px 0;">
        The following rows had a count hint in the product name that differs from the CSV pack-size column by more than 5&times;.
        Verify these items in your vendor price list before the next food-cost run.
      </p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #fef3c7;">
            <th style="text-align: left; padding: 6px 8px; color: #92400e; border-bottom: 1px solid #fde68a;">Product Name</th>
            <th style="text-align: center; padding: 6px 8px; color: #92400e; border-bottom: 1px solid #fde68a; white-space: nowrap;">CSV Pack Size</th>
            <th style="text-align: center; padding: 6px 8px; color: #92400e; border-bottom: 1px solid #fde68a; white-space: nowrap;">Name Says</th>
          </tr>
        </thead>
        <tbody>
          ${suspiciousLines.map((l, i) => `
            <tr style="background: ${i % 2 === 0 ? '#fffbeb' : '#ffffff'};">
              <td style="padding: 6px 8px; color: #1e293b; border-bottom: 1px solid #fef3c7;">${l.productName}</td>
              <td style="padding: 6px 8px; color: #475569; text-align: center; border-bottom: 1px solid #fef3c7;">${l.caseSize ?? '—'}</td>
              <td style="padding: 6px 8px; color: #92400e; font-weight: bold; text-align: center; border-bottom: 1px solid #fef3c7;">${l.nameCount ?? '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  const suspiciousRowsText = suspiciousLines.length > 0 ? `\n\nPACK-SIZE WARNINGS (${suspiciousLines.length} rows)\nThe following product names contain a count hint that differs from the CSV pack-size by more than 5x:\n${suspiciousLines.map(l => `  • ${l.productName} — CSV: ${l.caseSize ?? '?'}, Name says: ${l.nameCount ?? '?'}`).join('\n')}` : '';

  try {
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject: `Order guide imported: ${fileName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e293b; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">
              <span style="color: #ffffff;">FNB</span>
              <span style="color: #22c55e; font-size: 16px;"> cost pro</span>
            </h1>
          </div>
          <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1e293b; margin-top: 0;">Hi ${firstName},</h2>
            <p style="color: #475569; line-height: 1.6;">
              Your order guide has been imported successfully${vendorName ? ` for <strong>${vendorName}</strong>` : ''}.
            </p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
              <tr>
                <td style="padding: 8px 0; color: #64748b;">File</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">${fileName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Items imported</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">${totalImported}</td>
              </tr>
              ${inventoryItemsCreated > 0 ? `
              <tr>
                <td style="padding: 8px 0; color: #64748b;">New inventory items</td>
                <td style="padding: 8px 0; color: #1e293b; font-weight: 500;">${inventoryItemsCreated}</td>
              </tr>` : ''}
              ${suspiciousLines.length > 0 ? `
              <tr>
                <td style="padding: 8px 0; color: #92400e;">Pack-size warnings</td>
                <td style="padding: 8px 0; color: #92400e; font-weight: 500;">${suspiciousLines.length}</td>
              </tr>` : ''}
            </table>
            ${suspiciousRowsHtml}
          </div>
          <div style="background: #f1f5f9; padding: 16px; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} FNB Cost Pro. All rights reserved.
            </p>
          </div>
        </div>
      `,
      text: `Hi ${firstName},\n\nYour order guide "${fileName}" has been imported successfully${vendorName ? ` for ${vendorName}` : ''}.\n\nItems imported: ${totalImported}${inventoryItemsCreated > 0 ? `\nNew inventory items: ${inventoryItemsCreated}` : ''}${suspiciousLines.length > 0 ? `\nPack-size warnings: ${suspiciousLines.length}` : ''}${suspiciousRowsText}`,
    });
    console.log(`[Email] Import summary email sent to ${to}`);
  } catch (err) {
    console.error("[Email] Failed to send import summary email:", err);
  }
}

export async function sendSquareTokenRevokedAlert(opts: {
  to: string;
  firstName: string;
  companyName: string;
  merchantId: string;
  reconnectUrl: string;
}) {
  const transport = createTransport();
  if (!transport) {
    console.warn("[Email] Skipping Square token-revoked alert — no transport configured");
    return;
  }

  const { to, firstName, companyName, merchantId, reconnectUrl } = opts;

  try {
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject: `Action required: Square connection disconnected for ${companyName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e293b; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">
              <span style="color: #ffffff;">FNB</span>
              <span style="color: #22c55e; font-size: 16px;"> cost pro</span>
            </h1>
          </div>
          <div style="padding: 32px; background: #ffffff;">
            <h2 style="color: #1e293b; margin-top: 0;">Square Connection Disconnected</h2>
            <p style="color: #475569; line-height: 1.6;">Hi ${firstName},</p>
            <p style="color: #475569; line-height: 1.6;">
              The Square integration for <strong>${companyName}</strong> has been disconnected
              because the access token was revoked. Sales data will not sync until the connection
              is restored.
            </p>
            <div style="margin: 24px 0; padding: 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;">
              <p style="color: #991b1b; margin: 0; font-size: 14px;">
                <strong>Merchant ID:</strong> ${merchantId}
              </p>
            </div>
            <p style="color: #475569; line-height: 1.6;">
              Please reconnect your Square account as soon as possible to prevent gaps in your
              sales data.
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${reconnectUrl}"
                 style="display: inline-block; background: #22c55e; color: #ffffff;
                        text-decoration: none; padding: 14px 32px; border-radius: 8px;
                        font-weight: 600; font-size: 16px;">
                Reconnect Square
              </a>
            </div>
            <p style="color: #94a3b8; font-size: 13px;">
              If you did not disconnect Square intentionally, please check your Square account
              security settings and reconnect immediately.
            </p>
          </div>
          <div style="background: #f1f5f9; padding: 16px; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} FNB Cost Pro. All rights reserved.
            </p>
          </div>
        </div>
      `,
      text: `Hi ${firstName},\n\nThe Square integration for ${companyName} (Merchant ID: ${merchantId}) has been disconnected because the access token was revoked.\n\nSales data will not sync until the connection is restored. Please reconnect at:\n${reconnectUrl}\n\nIf you did not disconnect Square intentionally, please check your Square account security settings.`,
    });
    console.log(`[Email] Square token-revoked alert sent to ${to}`);
  } catch (err) {
    console.error("[Email] Failed to send Square token-revoked alert:", err);
  }
}

export async function sendContactEmail(opts: {
  name: string;
  email: string;
  company?: string;
  message?: string;
  operationType?: string;
  locationCount?: string;
  role?: string;
  currentSystem?: string;
  primaryChallenge?: string;
  contactPreference?: string;
}) {
  const { name, email, company, message, operationType, locationCount, role, currentSystem, primaryChallenge, contactPreference } = opts;
  const transport = createTransport();
  if (!transport) return;
  const contactTo = process.env.CONTACT_EMAIL || "info@fnbcostpro.com";

  const row = (label: string, value: string | undefined) =>
    value ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:160px;vertical-align:top;">${label}</td><td style="padding:8px 0;color:#111827;font-size:14px;">${value}</td></tr>` : "";

  try {
    await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: contactTo,
      replyTo: `"${name}" <${email}>`,
      subject: `Culinary Review Request: ${name}${company ? ` — ${company}` : ""}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
          <div style="background: #111827; padding: 24px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.01em;">New Culinary Review Request</h1>
          </div>
          <div style="padding: 24px; background: #ffffff;">
            <table style="width: 100%; border-collapse: collapse;">
              ${row("Name", name)}
              ${row("Email", `<a href="mailto:${email}" style="color:#16a34a;">${email}</a>`)}
              ${row("Company", company)}
              ${row("Operation type", operationType)}
              ${row("Locations / outlets", locationCount)}
              ${row("Role", role)}
              ${row("Current system", currentSystem)}
              ${row("Contact preference", contactPreference)}
            </table>
            ${primaryChallenge ? `
            <div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
              <p style="color:#6b7280;font-size:12px;margin:0 0 8px 0;text-transform:uppercase;letter-spacing:0.05em;">Primary Challenge</p>
              <p style="color:#111827;font-size:14px;margin:0;white-space:pre-wrap;">${primaryChallenge}</p>
            </div>` : ""}
            ${message ? `
            <div style="margin-top:16px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
              <p style="color:#6b7280;font-size:12px;margin:0 0 8px 0;text-transform:uppercase;letter-spacing:0.05em;">Message</p>
              <p style="color:#111827;font-size:14px;margin:0;white-space:pre-wrap;">${message}</p>
            </div>` : ""}
          </div>
          <div style="background: #f1f5f9; padding: 16px; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">&copy; ${new Date().getFullYear()} FNB Cost Pro. All rights reserved.</p>
          </div>
        </div>
      `,
      text: [
        `Culinary Review Request from ${name} (${email})`,
        company ? `Company: ${company}` : "",
        operationType ? `Operation type: ${operationType}` : "",
        locationCount ? `Locations/outlets: ${locationCount}` : "",
        role ? `Role: ${role}` : "",
        currentSystem ? `Current system: ${currentSystem}` : "",
        contactPreference ? `Contact preference: ${contactPreference}` : "",
        primaryChallenge ? `\nPrimary challenge:\n${primaryChallenge}` : "",
        message ? `\nMessage:\n${message}` : "",
      ].filter(Boolean).join("\n"),
    });
    console.log(`[Email] Culinary review request sent from ${email}`);
  } catch (err) {
    console.error("[Email] Failed to send contact email:", err);
    throw err;
  }
}
