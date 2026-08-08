/**
 * Google OIDC regression tests (#997)
 *
 * Covers the approved guardrails:
 *  - missing / unverified / non-boolean email_verified claims fail safely
 *  - verified-email linking only, normalized exact match
 *  - linking never touches password credentials, company, role, or stores
 *  - existing user + pending invitation → controlled conflict, invitation untouched
 *  - new users require a valid matching invitation (no self-registration)
 *  - fixed callback derived from APP_BASE_URL, never req.hostname
 *  - configuration gate requires all three explicit variables, no REPL_ID
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./storage", () => ({
  storage: {
    getUserBySsoId: vi.fn(),
    getUserByEmail: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    createUser: vi.fn(),
    getInvitationByToken: vi.fn(),
    acceptInvitation: vi.fn(),
    getCompanyStores: vi.fn(),
    assignUserToStore: vi.fn(),
  },
}));

import { storage } from "./storage";
import {
  upsertGoogleUser,
  isGoogleConfigured,
  getGoogleCallbackUrl,
} from "./googleAuth";

const mockStorage = storage as unknown as Record<string, ReturnType<typeof vi.fn>>;

const existingUser = {
  id: "user-1",
  email: "chef@fnb.com",
  companyId: "co-1",
  role: "store_manager",
  passwordHash: "$2b$10$existinghash",
  firstName: "Ana",
  lastName: "Ruiz",
  profileImageUrl: null,
  ssoProvider: null,
  ssoId: null,
};

const verifiedClaims = {
  sub: "google-sub-123",
  email: "chef@fnb.com",
  email_verified: true,
  given_name: "Ana",
  family_name: "Ruiz",
  picture: "https://lh3.example/photo.jpg",
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getUserBySsoId.mockResolvedValue(undefined);
  mockStorage.getUserByEmail.mockResolvedValue(undefined);
  mockStorage.getUser.mockResolvedValue(existingUser);
  mockStorage.updateUser.mockResolvedValue(undefined);
  mockStorage.getInvitationByToken.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("identity claim validation", () => {
  it("rejects a missing email claim without creating or linking anything", async () => {
    const result = await upsertGoogleUser({ sub: "s", email_verified: true });
    expect(result).toEqual({ ok: false, reason: "missing_email" });
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
    expect(mockStorage.createUser).not.toHaveBeenCalled();
  });

  it("rejects an empty/whitespace email", async () => {
    const result = await upsertGoogleUser({ sub: "s", email: "   ", email_verified: true });
    expect(result).toEqual({ ok: false, reason: "missing_email" });
  });

  it("rejects when email_verified is absent", async () => {
    const result = await upsertGoogleUser({ sub: "s", email: "chef@fnb.com" });
    expect(result).toEqual({ ok: false, reason: "unverified_email" });
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
    expect(mockStorage.createUser).not.toHaveBeenCalled();
  });

  it("rejects when email_verified is false", async () => {
    const result = await upsertGoogleUser({ sub: "s", email: "chef@fnb.com", email_verified: false });
    expect(result).toEqual({ ok: false, reason: "unverified_email" });
  });

  it('rejects when email_verified is the string "true" (strict boolean required)', async () => {
    const result = await upsertGoogleUser({ sub: "s", email: "chef@fnb.com", email_verified: "true" });
    expect(result).toEqual({ ok: false, reason: "unverified_email" });
  });
});

describe("existing user linking", () => {
  it("links Google identity to an existing user matched by normalized email", async () => {
    mockStorage.getUserByEmail.mockResolvedValue(existingUser);
    const result = await upsertGoogleUser({ ...verifiedClaims, email: "CHEF@FNB.COM " });
    expect(result.ok).toBe(true);
    expect(mockStorage.getUserByEmail).toHaveBeenCalledWith("chef@fnb.com");
    expect(mockStorage.updateUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ ssoProvider: "google", ssoId: "google-sub-123" }),
    );
  });

  it("never modifies password, company, role, or store fields during linking", async () => {
    mockStorage.getUserByEmail.mockResolvedValue(existingUser);
    await upsertGoogleUser(verifiedClaims);
    const updates = mockStorage.updateUser.mock.calls[0][1];
    expect(Object.keys(updates)).not.toContain("passwordHash");
    expect(Object.keys(updates)).not.toContain("password");
    expect(Object.keys(updates)).not.toContain("companyId");
    expect(Object.keys(updates)).not.toContain("role");
    expect(mockStorage.assignUserToStore).not.toHaveBeenCalled();
    expect(mockStorage.acceptInvitation).not.toHaveBeenCalled();
  });

  it("does not create a duplicate user for a verified matching email", async () => {
    mockStorage.getUserByEmail.mockResolvedValue(existingUser);
    const result = await upsertGoogleUser(verifiedClaims);
    expect(result.ok).toBe(true);
    expect(mockStorage.createUser).not.toHaveBeenCalled();
  });

  it("finds a previously linked user by provider+sub without an email lookup", async () => {
    mockStorage.getUserBySsoId.mockResolvedValue({ ...existingUser, ssoProvider: "google", ssoId: "google-sub-123" });
    const result = await upsertGoogleUser(verifiedClaims);
    expect(result.ok).toBe(true);
    expect(mockStorage.getUserBySsoId).toHaveBeenCalledWith("google", "google-sub-123");
    expect(mockStorage.getUserByEmail).not.toHaveBeenCalled();
  });

  it("only fills profile fields when they are absent on the existing user", async () => {
    mockStorage.getUserByEmail.mockResolvedValue({ ...existingUser, firstName: "Existing", profileImageUrl: null });
    await upsertGoogleUser(verifiedClaims);
    const updates = mockStorage.updateUser.mock.calls[0][1];
    expect(updates.firstName).toBeUndefined(); // already set — untouched
    expect(updates.profileImageUrl).toBe(verifiedClaims.picture); // absent — filled
  });
});

describe("invitation handling", () => {
  const invitation = {
    token: "inv-tok",
    email: "chef@fnb.com",
    companyId: "co-2",
    role: "company_admin",
    storeIds: [],
  };

  it("blocks with invitation_conflict when an existing user has a pending invitation, leaving it unresolved", async () => {
    mockStorage.getUserByEmail.mockResolvedValue(existingUser);
    mockStorage.getInvitationByToken.mockResolvedValue(invitation);
    const result = await upsertGoogleUser(verifiedClaims, "inv-tok");
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe("invitation_conflict");
    expect(mockStorage.acceptInvitation).not.toHaveBeenCalled();
    expect(mockStorage.updateUser).not.toHaveBeenCalled();
  });

  it("rejects an unknown Google user with no invitation (no self-registration)", async () => {
    const result = await upsertGoogleUser(verifiedClaims);
    expect(result).toEqual({ ok: false, reason: "no_invitation" });
    expect(mockStorage.createUser).not.toHaveBeenCalled();
  });

  it("ignores an invitation whose email does not match the Google email", async () => {
    mockStorage.getInvitationByToken.mockResolvedValue({ ...invitation, email: "other@fnb.com" });
    const result = await upsertGoogleUser(verifiedClaims, "inv-tok");
    expect(result).toEqual({ ok: false, reason: "no_invitation" });
    expect(mockStorage.createUser).not.toHaveBeenCalled();
    expect(mockStorage.acceptInvitation).not.toHaveBeenCalled();
  });

  it("creates a new invited user, accepts the invitation, and assigns admin stores", async () => {
    mockStorage.getInvitationByToken.mockResolvedValue(invitation);
    mockStorage.createUser.mockResolvedValue({ id: "user-new", email: "chef@fnb.com", companyId: "co-2" });
    mockStorage.getCompanyStores.mockResolvedValue([{ id: "store-1" }, { id: "store-2" }]);
    const result = await upsertGoogleUser(verifiedClaims, "inv-tok");
    expect(result.ok).toBe(true);
    expect(mockStorage.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "chef@fnb.com", companyId: "co-2", ssoProvider: "google", ssoId: "google-sub-123", role: "company_admin" }),
    );
    expect(mockStorage.acceptInvitation).toHaveBeenCalledWith("inv-tok");
    expect(mockStorage.assignUserToStore).toHaveBeenCalledTimes(2);
  });

  it("assigns explicitly invited stores for non-admin invitations", async () => {
    mockStorage.getInvitationByToken.mockResolvedValue({ ...invitation, role: "store_user", storeIds: ["store-9"] });
    mockStorage.createUser.mockResolvedValue({ id: "user-new" });
    const result = await upsertGoogleUser(verifiedClaims, "inv-tok");
    expect(result.ok).toBe(true);
    expect(mockStorage.assignUserToStore).toHaveBeenCalledWith("user-new", "store-9");
  });
});

describe("production configuration", () => {
  it("requires all of OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, APP_BASE_URL", () => {
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.APP_BASE_URL;
    expect(isGoogleConfigured()).toBe(false);

    process.env.OIDC_CLIENT_ID = "cid";
    expect(isGoogleConfigured()).toBe(false);

    process.env.OIDC_CLIENT_SECRET = "csecret";
    expect(isGoogleConfigured()).toBe(false);

    process.env.APP_BASE_URL = "https://app.fnbcostpro.com";
    expect(isGoogleConfigured()).toBe(true);
  });

  it("is enabled without any REPL_ID dependency", () => {
    delete process.env.REPL_ID;
    process.env.OIDC_CLIENT_ID = "cid";
    process.env.OIDC_CLIENT_SECRET = "csecret";
    process.env.APP_BASE_URL = "https://app.fnbcostpro.com";
    expect(isGoogleConfigured()).toBe(true);
  });

  it("derives the fixed canonical callback from APP_BASE_URL only", () => {
    process.env.APP_BASE_URL = "https://app.fnbcostpro.com";
    expect(getGoogleCallbackUrl()).toBe("https://app.fnbcostpro.com/api/sso/callback");
    process.env.APP_BASE_URL = "https://app.fnbcostpro.com/";
    expect(getGoogleCallbackUrl()).toBe("https://app.fnbcostpro.com/api/sso/callback");
  });

  it("throws when APP_BASE_URL is missing rather than falling back to a hostname", () => {
    delete process.env.APP_BASE_URL;
    expect(() => getGoogleCallbackUrl()).toThrow();
  });
});
