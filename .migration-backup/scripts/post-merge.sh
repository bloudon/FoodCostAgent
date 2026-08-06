#!/bin/bash
set -e
npm install
npx drizzle-kit push --force < /dev/null || true
