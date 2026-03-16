FROM node:22-slim AS base

RUN corepack enable pnpm
RUN apt-get update && apt-get install -y git python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code @openai/codex

# Mark Claude Code onboarding as complete (required for headless auth)
RUN mkdir -p /root/.claude && echo '{"hasCompletedOnboarding":true}' > /root/.claude.json

WORKDIR /app

# Install dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/
COPY packages/wire/package.json packages/wire/
COPY packages/mcp/package.json packages/mcp/
COPY packages/pi/package.json packages/pi/
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/wire/ packages/wire/
COPY packages/mcp/ packages/mcp/
COPY packages/pi/ packages/pi/
COPY packages/server/ packages/server/

# Build wire protocol
RUN cd packages/wire && pnpm exec tsc

EXPOSE 4800

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4800

CMD ["pnpm", "--filter", "server", "exec", "tsx", "src/main.ts"]
