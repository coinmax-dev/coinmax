#!/bin/bash
cd "$(dirname "$0")"
echo "🧹 Cleaning..."
rm -rf dist .wrangler .env.local
echo "🔨 Building..."
npm run build
echo "🚀 Deploying (fresh upload)..."
npx wrangler deploy
echo "✅ Done"
