#!/usr/bin/env bash
set -e

echo "🚀 Starting Campus Mess System automated deployment on server..."

# 0. Explicitly load environment and Node/PM2 paths for non-interactive shells
export HOME=${HOME:-/home/ubuntu}
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$HOME/.profile" ] && \. "$HOME/.profile"
[ -s "$HOME/.bashrc" ] && \. "$HOME/.bashrc"

# Include NVM and standard binary paths in PATH
NODE_NVM_DIR=$(find "$NVM_DIR/versions/node" -maxdepth 2 -name "bin" 2>/dev/null | tail -n 1)
export PATH=$PATH:$NODE_NVM_DIR:/usr/local/bin:/usr/bin:/bin

echo "=== Environment Info ==="
echo "Node: $(which node 2>/dev/null || echo 'Not in PATH')"
echo "NPM:  $(which npm 2>/dev/null || echo 'Not in PATH')"
echo "PM2:  $(which pm2 2>/dev/null || echo 'Not in PATH')"
echo "========================"

# 1. Fetch latest changes from main branch
echo "📥 Pulling latest code from GitHub..."
git fetch origin main
git reset --hard origin/main

# 2. Install dependencies & generate Prisma client
echo "📦 Installing project dependencies..."
npm install

echo "💎 Generating Prisma client..."
npm run prisma:generate

# 3. Build backend and frontend packages
echo "🔨 Building application bundles..."
npm run build

# 4. Restart or reload PM2 processes cleanly
echo "🔄 Reloading PM2 processes..."
if pm2 describe campus-mess-api > /dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs --update-env
fi
pm2 save

# 5. Immediate local health check verification
echo "🩺 Verifying local health endpoint (/healthz)..."
sleep 3
if curl -sf http://localhost:3000/healthz > /dev/null 2>&1; then
  echo "✅ Server is alive and responsive!"
else
  echo "⚠️ Note: Server is still starting or health check pending. Check 'pm2 logs campus-mess-api'."
fi

echo "🎉 Deployment completed successfully!"
