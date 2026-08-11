/**
 * SSO notification helpers — shared by Replit SSO (ssoAuth.ts) and Google SSO
 * (googleAuth.ts). Extracted here to avoid a circular-import chain between the
 * two modules.
 *
 * ## Idempotency and concurrency safety
 *
 * Each invitation row has a `notification_sent_at` timestamp that acts as a
 * single-use notification slot.  We use an atomic DB-level compare-and-set
 * (`claimInvitationForNotification`) that sets the timestamp only when it is
 * currently NULL, so exactly one concurrent SSO callback wins the claim.
 *
 * On delivery success   → claim stays; repeat logins are silent.
 * On delivery failure   → claim is released via `releaseInvitationNotificationClaim`
 *                         so the next SSO login can retry.
 * When SMTP unconfigured→ same as failure; claim is released.
 *
 * ## Company scoping
 *
 * When the SSO flow validated a specific invitation token, the caller passes
 * that invitation directly so we notify only the correct company's admin.
 * When no specific invitation is available (user arrived without a token), we
 * query all pending invitations for the email and notify each inviting admin
 * independently — one notification per invitation, correctly scoped to its
 * own company.
 */

import { storage } from "./storage";
import { sendPendingApprovalNotification } from "./email";

type PendingUser = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
};

type AnyInvitation = {
  id: string;
  invitedBy?: string | null;
  notificationSentAt?: Date | null;
};

/**
 * Notify the inviting admin(s) that an SSO user is waiting for approval.
 *
 * @param user - The SSO user who ended up in pending state.
 * @param specificInvitation - When the SSO flow validated a specific invitation
 *   token, pass that invitation here.  Limits the notification to exactly that
 *   company's admin.  When omitted, all pending invitations for the email are
 *   checked and each company's admin is notified independently.
 */
export async function notifyInvitingAdmin(
  user: PendingUser,
  specificInvitation?: AnyInvitation,
): Promise<void> {
  const invitationsToCheck: AnyInvitation[] = specificInvitation
    ? [specificInvitation]
    : await storage.getPendingInvitationsByEmail(user.email);

  const baseUrl = process.env.APP_BASE_URL || "https://app.fnbcostpro.com";
  const settingsUrl = `${baseUrl}/settings/users`;

  for (const invitation of invitationsToCheck) {
    // Quick pre-check before attempting an atomic DB round-trip.
    if (invitation.notificationSentAt) continue;
    if (!invitation.invitedBy) continue;

    // Atomically claim the notification slot.  Returns false when another
    // concurrent callback already claimed it (skip without sending).
    const claimed = await storage.claimInvitationForNotification(invitation.id);
    if (!claimed) continue;

    const admin = await storage.getUser(invitation.invitedBy);
    if (!admin?.email) {
      // Inviting admin has no email — release so the slot can be retried if
      // the admin record is corrected later.
      await storage.releaseInvitationNotificationClaim(invitation.id).catch(() => {});
      continue;
    }

    const userName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
    const adminFirstName = admin.firstName || admin.email;

    try {
      const sent = await sendPendingApprovalNotification({
        adminTo: admin.email,
        adminFirstName,
        userName,
        userEmail: user.email,
        settingsUrl,
      });

      if (!sent) {
        // SMTP not configured — release so the next login can retry once SMTP
        // credentials are added to the environment.
        await storage.releaseInvitationNotificationClaim(invitation.id).catch(() => {});
      }
      // sent === true → claim stays; notification delivered successfully.
    } catch (err) {
      // Delivery failed (e.g. SMTP error) — release the claim so the next SSO
      // login can attempt delivery again.
      await storage.releaseInvitationNotificationClaim(invitation.id).catch(() => {});
      console.error(
        `[SSO Notify] Delivery failed for invitation ${invitation.id}; claim released for retry:`,
        err,
      );
      // Continue processing remaining invitations even if one fails.
    }
  }
}
