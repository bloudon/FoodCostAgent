# Installing the FnB Cost Pro Extension (Load Unpacked)

These steps install the extension in **Developer Mode** — no Chrome Web Store required.

## Requirements
- Google Chrome 115+
- A FnB Cost Pro account (company admin or store manager role)

---

## Steps

### 1 — Enable Developer Mode
1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** ON (top-right corner)

### 2 — Load the extension
1. Click **Load unpacked**
2. Navigate to the `extension/` folder in this project
3. Click **Select Folder**
4. The "FnB Price Sync" extension will appear in your list

### 3 — Pin the extension (recommended)
1. Click the puzzle-piece icon in the Chrome toolbar
2. Click the pin icon next to **FnB Price Sync**
3. The FnB icon will appear in your toolbar for easy access

### 4 — Pair the extension with FnB Cost Pro
1. Log in to FnB Cost Pro at `app.fnbcostpro.com`
2. Go to **Vendors → [Vendor] → Sync Settings** (or the Extension Pilot page in dev)
3. Click **Generate Pairing Code** — a 9-character code appears (valid 2 min)
4. Click the FnB icon in Chrome → enter the code → **Connect to FnB**
5. A green "Connected" badge confirms pairing

### 5 — Start a sync
1. In FnB Cost Pro, click **Create Sync Job** (after pairing)
2. Navigate to the Cut+Dry catalog or order guide page
3. The FnB overlay appears in the bottom-right corner
4. Click **Start Capture** — the extension scans all pages and uploads prices

---

## Permissions used

| Permission | Why |
|---|---|
| `storage` | Saves the bearer token and installationId locally (never sent to content scripts) |
| `scripting` | Injects the capture overlay on Cut+Dry pages |
| `https://*.cutanddry.com/*` | Reads catalog prices from the supplier portal |
| `https://app.fnbcostpro.com/*` | Sends captured prices to FnB |

The extension **never modifies** your Cut+Dry carts, orders, or quantities.
