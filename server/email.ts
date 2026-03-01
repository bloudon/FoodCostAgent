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
