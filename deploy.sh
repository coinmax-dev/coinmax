#!/bin/bash
cd "$(dirname "$0")"
echo "🔨 Building..."
npm run build
echo "🧹 Clearing wrangler cache..."
rm -rf .wrangler
echo "🚀 Deploying..."
npx wrangler deploy
echo "✅ Done"
