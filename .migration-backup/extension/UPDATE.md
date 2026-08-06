# Updating the Extension

Because the extension is loaded unpacked (not from the Chrome Web Store), updates require a manual reload.

## Steps

### 1 — Pull the latest code
```bash
git pull origin main
```

### 2 — Reload in Chrome
1. Go to `chrome://extensions`
2. Find **FnB Price Sync**
3. Click the **Reload** icon (circular arrow) on the extension card

### 3 — Verify the version
Check the version number shown under the extension name. It should match `version` in `extension/manifest.json`.

---

## After a major update

If the update changes the manifest's `permissions` or `host_permissions`, Chrome will disable the extension and prompt you to re-approve the new permissions:
1. A banner will appear on `chrome://extensions`
2. Click **Enable** and accept the new permissions

**You do not need to re-pair** the extension after a reload unless the update specifically requires it (this will be noted in the release notes).

---

## Checking for updates
The engineering team will communicate updates via your normal internal channels.
Extension version is visible in the FnB popup (hover over the "FnB Price Sync" title).
