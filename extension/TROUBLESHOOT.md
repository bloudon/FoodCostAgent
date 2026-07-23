# Troubleshooting Guide — FnB Price Sync Extension

---

## "Invalid or expired code"
- Pairing codes are valid for **2 minutes** — generate a new one in FnB and enter it immediately
- Make sure you copied all characters (9-character alphanumeric, no spaces)
- Codes are case-insensitive but must match exactly

---

## "Code already claimed"
- Each code can only be claimed once
- If you re-installed or re-loaded the extension, generate a fresh code in FnB

---

## "Too many claim attempts"
- Rate limit: 5 claims per installation per hour
- Wait 60 minutes, or contact your account admin

---

## Overlay doesn't appear on Cut+Dry
1. Confirm the extension is paired — click the FnB icon, check for "Connected" badge
2. Ensure a sync job was created in FnB Cost Pro (after pairing)
3. Make sure you're on a **catalog or order-guide page** (URL must contain `/catalog`, `/order-guide`, `/products`, or `/items`)
4. Reload the Cut+Dry page after creating the sync job
5. Check `chrome://extensions` → FnB Price Sync → Errors for any console errors

---

## "Wrong supplier" error
The sync job was configured for a different supplier than the one visible on screen.
- Navigate to the correct supplier's order guide in Cut+Dry
- Or create a new sync job in FnB for the supplier you're on

---

## "Partial capture" warning
Some rows were visible but could not be parsed (e.g. missing SKU or unreadable price).
- Items without prices are sent to the **Review queue** in FnB — not silently dropped
- Check the Review tab after the sync

---

## Sync shows complete but prices didn't update
1. Ensure the Cut+Dry SKU matches the **Vendor SKU** on the item in FnB
2. Items with unmatched SKUs go to the **Review queue** — not auto-applied
3. Filter prices ≤ $0 are always rejected — check that prices were visible on screen

---

## Extension says "No active sync job"
1. The web app must create a sync job **after** pairing
2. Jobs expire after being COMPLETE, FAILED, or EXPIRED
3. Go to FnB Cost Pro → Vendor Sync → Create new sync job

---

## Token expired / "Invalid token"
Tokens expire after 8 hours.
1. Click the FnB popup icon → **Disconnect**
2. In FnB Cost Pro, generate a new pairing code
3. Click **Connect to FnB** in the popup and enter the new code

---

## Checking extension logs
1. Go to `chrome://extensions`
2. Click **Service Worker** link under FnB Price Sync → opens DevTools
3. Check the Console tab for `[FnB SW]` prefixed messages

For content-script logs, open DevTools on a Cut+Dry page (F12) → Console → filter `[FnB]`.
