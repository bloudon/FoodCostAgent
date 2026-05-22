#!/usr/bin/env bash
#
# FNB Cost Pro — IDrive Linux Client: Install & Authenticate
#
# Run this ONCE on the VPS to install the IDrive Perl-based Linux client
# and link it to your IDrive account.
#
# Usage (on VPS, as the user that runs PM2 / owns the app):
#   chmod +x scripts/backup/install-idrive.sh
#   ./scripts/backup/install-idrive.sh
#
# Prerequisites:
#   - Perl 5.8+ installed  (sudo apt install perl)
#   - curl installed       (sudo apt install curl)
#   - Your IDrive username and password ready
#
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }
fail() { echo -e "${RED}✖  $1${NC}"; exit 1; }

IDRIVE_HOME="$HOME/IDrive"

echo "═══════════════════════════════════════════════"
echo "  FNB Cost Pro — IDrive Client Setup"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════"

step "Checking prerequisites"
command -v perl  >/dev/null 2>&1 || fail "perl not found. Run: sudo apt install perl"
command -v curl  >/dev/null 2>&1 || fail "curl not found. Run: sudo apt install curl"
command -v unzip >/dev/null 2>&1 || fail "unzip not found. Run: sudo apt install unzip"
echo "  perl ✓  curl ✓  unzip ✓"

step "Downloading IDrive Linux client"
mkdir -p "$IDRIVE_HOME"
cd "$IDRIVE_HOME"

curl -L "https://www.idrive.com/downloads/linux/download-for-linux" \
     -o IDriveForLinux.zip

unzip -o IDriveForLinux.zip
echo "  Downloaded and extracted."

# The IDrive Perl client directory is named IDriveForLinux or similar
IDRIVE_DIR=$(find "$IDRIVE_HOME" -maxdepth 2 -name "*.pl" | head -1 | xargs dirname 2>/dev/null || true)
if [[ -z "$IDRIVE_DIR" ]]; then
  IDRIVE_DIR="$IDRIVE_HOME/IDriveForLinux"
fi
echo "  IDrive client directory: $IDRIVE_DIR"

step "Authenticating with IDrive"
echo ""
echo "  You will be prompted for your IDrive credentials."
echo "  (They are sent directly to IDrive — not stored in this script.)"
echo ""
cd "$IDRIVE_DIR"
perl "$IDRIVE_DIR/login.pl"

step "Verifying connection"
perl "$IDRIVE_DIR/listDevices.pl" || warn "Could not list devices yet — this is okay on first login."

echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}✔  IDrive client installed and authenticated.${NC}"
echo ""
echo "  Client path: $IDRIVE_DIR"
echo "  Next step: run ./scripts/backup/run-backup.sh to perform first backup."
echo "═══════════════════════════════════════════════"

# Write the IDrive directory path to a shared config so other scripts can find it
mkdir -p "$HOME/.fnbcostpro-backup"
echo "IDRIVE_DIR=$IDRIVE_DIR" > "$HOME/.fnbcostpro-backup/config"
echo "  Config written to ~/.fnbcostpro-backup/config"
