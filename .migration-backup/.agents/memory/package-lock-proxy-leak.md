---
name: package-lock Replit proxy leak
description: Replit's internal npm proxy leaks into package-lock.json, breaking npm install on the VPS.
---

## Rule
After any `npm install` in the Replit environment, `package-lock.json` may contain `resolved` URLs pointing to `http://package-firewall.replit.local/npm/`. These are unreachable outside Replit — the VPS deploy will fail with `EAI_AGAIN`.

**Why:** Replit routes npm traffic through an internal package firewall proxy. When packages are installed, the proxy URL is recorded as the `resolved` field in `package-lock.json`.

**How to apply:** Before pushing a deploy-critical `package-lock.json` change, check for proxy URLs and replace them:

```bash
grep -c "package-firewall.replit.local" package-lock.json
sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json
```

Run this whenever `package-lock.json` changes (new installs, upgrades). The substitution is safe — paths are identical after the host/prefix swap.
