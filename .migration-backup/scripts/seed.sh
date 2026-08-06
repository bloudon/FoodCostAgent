#!/bin/bash
set -e
export $(grep -v '^#' .env | xargs)
echo "🌱 Running seed against: ${DATABASE_URL:0:40}..."
npx tsx server/seed.ts
