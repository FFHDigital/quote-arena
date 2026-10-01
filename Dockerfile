# Web app, job worker and headless Chromium in one container.
FROM node:24-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund && npx playwright install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ARENA_EMBEDDED_WORKER=1 \
    ARENA_BASE_URL=http://localhost:3000 \
    ARENA_DATA_DIR=/app/data
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
