# Web app, job worker, headless Chromium and the Claude Code / Codex CLIs in one container.
FROM node:24-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \n    && npm install --no-audit --no-fund && npx playwright install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/*
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code @openai/codex && claude --version && codex --version

COPY . .
RUN npm run build && chmod +x scripts/start.sh

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ARENA_EMBEDDED_WORKER=1 \
    ARENA_BASE_URL=http://localhost:3000 \
    ARENA_DATA_DIR=/app/data \
    DISABLE_AUTOUPDATER=1
EXPOSE 3000
CMD ["scripts/start.sh"]
