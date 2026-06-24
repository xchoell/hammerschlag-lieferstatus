FROM node:20-alpine

WORKDIR /app

# Nur Manifeste zuerst -> Layer-Cache für Dependencies
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Healthcheck auf den /healthz-Endpoint
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "src/server.js"]
