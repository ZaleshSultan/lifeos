FROM node:22-alpine AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

# The credential validation bridge reuses the worker's hardened Moodle client.
RUN apk add --no-cache python3 py3-requests py3-beautifulsoup4

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/obsidian/package.json packages/obsidian/package.json

RUN pnpm install --frozen-lockfile

COPY apps/bot apps/bot
COPY packages packages
COPY workers/common/*.py workers/common/
COPY workers/university-sync/aitu-parser/*.py workers/university-sync/aitu-parser/

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "--filter", "@lifeos/bot", "start"]
