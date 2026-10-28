FROM node:22-slim

# Binance Agentic Wallet CLI (baw). Sürüm sabit: güncellemeyi bilerek yap.
RUN npm install -g @binance/agentic-wallet@1.12.0 && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src

# Oturum ve durum dosyası Railway volume'unda (/data) tutulur.
ENV BINANCE_BAW_DIR=/data/baw \
    STATE_PATH=/data/state.json \
    NODE_ENV=production

CMD ["node", "src/index.js"]
