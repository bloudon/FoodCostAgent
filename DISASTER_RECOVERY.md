# FNB Cost Pro — Disaster Recovery Runbook

**Audience:** On-call managers and team leads. You do not need to be a developer to follow this guide.

**Production URL:** https://app.fnbcostpro.com
**Last updated:** May 2026

---

## Quick Reference — Which scenario fits?

| Situation | Go to |
|---|---|
| App is down but the server itself is running | [Scenario A — App crash / PM2 restart](#scenario-a--app-crash--pm2-restart) |
| Database is corrupted or data was accidentally deleted | [Scenario B — Database-only restore](#scenario-b--database-only-restore) |
| The entire VPS is gone / unresponsive | [Scenario C — Full server rebuild](#scenario-c--full-server-rebuild) |

If you are unsure, start with Scenario A. It is the fastest and safest first step.

---

## Before you begin — What you will need

- **SSH credentials:** The VPS login username, IP address, and SSH key file (or password). These are stored in the team password manager (1Password / Bitwarden — ask your admin).
- **IDrive credentials:** The IDrive e2 account email and password (or access key). Also in the password manager.
- **A computer with a terminal.** On Mac, open the Terminal app. On Windows, use PowerShell or install PuTTY.

---

## How to SSH into the VPS

SSH is how you remotely control the server from your computer. Every scenario below starts here.

1. Open your terminal.
2. Type the following command, replacing the placeholders with the real values from the password manager:

   ```
   ssh -i /path/to/your/key.pem username@SERVER_IP_ADDRESS
   ```

   **Example (if no key file is needed and you use a password):**
   ```
   ssh username@SERVER_IP_ADDRESS
   ```

3. When asked "Are you sure you want to continue connecting?" type `yes` and press Enter.
4. Enter the password if prompted.
5. You should see a command prompt like `username@vps:~$`. You are now inside the server.

> **Tip:** If the connection is refused, the server may be fully down. Contact your VPS hosting provider (e.g., DigitalOcean / Hetzner / Linode) to check server status or power it on.

---

## Scenario A — App crash / PM2 restart

**Use when:** The website is down or showing errors, but you can still SSH into the server.

**Estimated time:** 2–5 minutes.

### Step 1 — SSH into the server
Follow the [SSH instructions above](#how-to-ssh-into-the-vps).

### Step 2 — Check if PM2 is running
PM2 is the process manager that keeps the app alive. Run:

```
pm2 status
```

You will see a table. The app should show `online` in the status column. If it shows `errored` or `stopped`, continue to Step 3.

### Step 3 — Restart the app
```
pm2 restart all
```

Wait about 10 seconds, then run `pm2 status` again to confirm it shows `online`.

### Step 4 — Check the live logs for errors
```
pm2 logs --lines 50
```

Read the last 50 lines. Look for red `ERROR` messages. If you see a specific error you do not understand, copy it and contact a developer.

### Step 5 — Verify the app is live
Open https://app.fnbcostpro.com in your browser. Log in. If it loads, you are done.

---

## Scenario B — Database-only restore

**Use when:** Data is missing, corrupted, or was accidentally deleted — but the server itself is running fine.

**Estimated time:** 20–40 minutes depending on backup size.

> **Warning:** Restoring the database will overwrite current data with data from the backup point in time. Any changes made after the backup was taken will be lost. Only proceed if directed to by a manager or developer.

### Step 1 — SSH into the server
Follow the [SSH instructions above](#how-to-ssh-into-the-vps).

### Step 2 — Navigate to the backup scripts folder
```
cd /home/username/fnbcostpro/scripts/backup
```

> If this path does not exist, ask a developer for the correct location.

### Step 3 — List available backups on IDrive
IDrive is the off-site backup storage service. Run the helper script:

```
bash list-backups.sh
```

This will display a list of available database backups with timestamps, for example:
```
fnbcostpro-db-2026-05-21-02-00.dump
fnbcostpro-db-2026-05-20-02-00.dump
fnbcostpro-db-2026-05-19-02-00.dump
```

Choose the most recent backup dated **before** the problem occurred.

### Step 4 — Download the chosen backup from IDrive
Replace the filename with the one you chose:

```
bash download-backup.sh fnbcostpro-db-2026-05-21-02-00.dump
```

The file will download to the `/tmp/restore/` folder on the server. This may take a few minutes.

### Step 5 — Stop the app (to prevent new writes during restore)
```
pm2 stop all
```

### Step 6 — Restore the database
Run the restore script with the filename you downloaded:

```
bash test-restore.sh /tmp/restore/fnbcostpro-db-2026-05-21-02-00.dump
```

The script will:
- Drop the existing database tables
- Recreate them from the backup file
- Confirm success or show an error

This step takes 5–15 minutes depending on database size.

### Step 7 — Restart the app
```
pm2 restart all
```

### Step 8 — Verify
1. Run `pm2 status` — confirm `online`.
2. Open https://app.fnbcostpro.com — log in and verify data looks correct.
3. Spot-check a few records (inventory items, recipes) to confirm data is from the expected date.

### Step 9 — Notify the team
Let the team know what time the database was restored to so they know what data may need to be re-entered.

---

## Scenario C — Full server rebuild

**Use when:** The VPS is completely gone, unresponsive, or your hosting provider says it is destroyed.

**Estimated time:** 1–3 hours. Involve a developer for this scenario.

> This is the most complex scenario. The steps below outline the full recovery path. A developer should lead this process; this guide helps you understand and assist.

### Phase 1 — Provision a new server

1. Log in to your VPS hosting provider control panel (DigitalOcean, Hetzner, Linode, etc.).
2. Create a new server (droplet/instance) with:
   - **OS:** Ubuntu 22.04 LTS
   - **Size:** Match or exceed the previous server's specs (ask a developer if unsure)
   - **Region:** Same region as before if possible
3. Note the new server's IP address.

### Phase 2 — Install required software

SSH into the new server as `root`, then run these commands one at a time:

```bash
# Update system packages
apt update && apt upgrade -y

# Install Node.js (version 20)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2

# Install Git
apt install -y git

# Install PostgreSQL client tools (for DB restore)
apt install -y postgresql-client
```

### Phase 3 — Restore the application code

```bash
# Create app directory
mkdir -p /home/deploy/fnbcostpro
cd /home/deploy/fnbcostpro

# Clone the repository
git clone https://github.com/YOUR_ORG/fnbcostpro.git .

# Install dependencies
npm install

# Build the application
npm run build
```

### Phase 4 — Restore environment variables

The app requires secret keys and configuration values (database URL, Stripe keys, etc.). These are **not** stored in the code repository for security reasons.

1. Retrieve the `.env` file from the team password manager or a secure backup.
2. Upload it to the server:

   From your local computer (not inside SSH), run:
   ```
   scp /path/to/.env username@NEW_SERVER_IP:/home/deploy/fnbcostpro/.env
   ```

3. Verify it uploaded correctly:
   ```
   ls -la /home/deploy/fnbcostpro/.env
   ```

### Phase 5 — Restore the database

Follow [Scenario B, Steps 3–6](#step-3--list-available-backups-on-idrive) to download and restore the most recent database backup from IDrive.

> **Note:** If the app uses Neon serverless PostgreSQL (cloud-hosted), the database may already be intact and separate from the server. Check with a developer — you may be able to skip this phase.

### Phase 6 — Start the application

```bash
cd /home/deploy/fnbcostpro

# Start the app with PM2
pm2 start npm --name "fnbcostpro" -- start

# Save PM2 configuration so it auto-starts on reboot
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup` (it will look like `sudo env PATH=... pm2 startup`).

### Phase 7 — Point the domain to the new server

1. Log in to your DNS provider (the service that manages `fnbcostpro.com` — likely Cloudflare or your domain registrar).
2. Find the `A` record for `app.fnbcostpro.com`.
3. Change it to point to the new server's IP address.
4. DNS changes can take 5–30 minutes to propagate worldwide.

### Phase 8 — Verify
1. Wait for DNS to update, then open https://app.fnbcostpro.com.
2. Log in and confirm the app works.
3. Test a critical workflow: log in as a manager, check inventory, open a recipe.

### Phase 9 — Update the mobile app config (if IP changed)
The Expo mobile app points to `app.fnbcostpro.com`. As long as DNS is updated correctly, the mobile app should automatically route to the new server. No mobile app update should be required.

---

## After any recovery — Checklist

After completing any of the scenarios above, run through this checklist before declaring recovery complete:

- [ ] https://app.fnbcostpro.com loads without errors
- [ ] You can log in with a real manager account
- [ ] Inventory items are visible
- [ ] At least one recipe opens correctly
- [ ] The mobile app connects successfully (ask a floor staff member to test)
- [ ] PM2 shows `online` status (`pm2 status`)
- [ ] Backups are running again (check the next scheduled backup ran, or trigger one manually with `bash scripts/backup/run-backup.sh`)
- [ ] The team has been notified of what happened and what data, if any, was lost

---

## Who to contact

| Role | Responsibility |
|---|---|
| On-call developer | Lead technical recovery, interpret error messages |
| VPS hosting provider support | Server hardware issues, IP/firewall problems |
| IDrive support | Backup download issues |
| Domain registrar / Cloudflare | DNS changes |
| Stripe support | Payment issues after recovery |

---

## Glossary — Plain English definitions

| Term | What it means |
|---|---|
| **SSH** | A secure way to remotely control the server from your computer using a terminal |
| **VPS** | The rented server computer in a data center that runs the app |
| **PM2** | Software that keeps the app running and restarts it if it crashes |
| **Database** | Where all the app's data lives — inventory, recipes, users, orders |
| **Dump / backup file** | A snapshot copy of the database saved at a point in time |
| **IDrive** | The cloud service where backup copies are stored off-site |
| **DNS** | The system that translates `app.fnbcostpro.com` into the server's IP address |
| **npm** | The tool used to install and run the app's code |
| **Git** | The system used to store and download the app's source code |
| **Neon** | The cloud-hosted database service (the database may live here, separately from the VPS) |
