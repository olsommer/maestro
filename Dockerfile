# Stage 1: Build nsjail from source
FROM debian:bookworm-slim AS nsjail-builder

RUN apt-get update && apt-get install -y \
    git make pkg-config flex bison \
    gcc g++ \
    libprotobuf-dev protobuf-compiler \
    libnl-3-dev libnl-route-3-dev \
 && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/google/nsjail.git /nsjail \
 && cd /nsjail && make -j$(nproc) \
 && cp /nsjail/nsjail /usr/local/bin/nsjail

# Stage 2: Main image
FROM node:22-slim AS base

# Install nsjail runtime dependencies + build tools
RUN apt-get update && apt-get install -y \
    git python3 make g++ curl bubblewrap \
    libprotobuf32 libnl-3-200 libnl-route-3-200 \
 && rm -rf /var/lib/apt/lists/*

# Copy nsjail binary from builder
COPY --from=nsjail-builder /usr/local/bin/nsjail /usr/local/bin/nsjail

RUN corepack enable pnpm
RUN npm install -g @anthropic-ai/claude-code @openai/codex

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# Create a non-root sandbox user for jailed agent processes
RUN groupadd -g 1500 sandbox && useradd -u 1500 -g 1500 -m -s /bin/bash sandbox

# Mark Claude Code onboarding as complete (for both root and sandbox user)
RUN mkdir -p /root/.claude && echo '{"hasCompletedOnboarding":true}' > /root/.claude.json \
 && mkdir -p /home/sandbox/.claude && echo '{"hasCompletedOnboarding":true}' > /home/sandbox/.claude.json \
 && chown -R sandbox:sandbox /home/sandbox

# Allow sandbox user to traverse /root so it can access mounted project dirs
# (only execute/traverse bit, not read — sandbox can't list /root contents)
RUN chmod 711 /root \
 && mkdir -p /root/maestro-projects && chmod 755 /root/maestro-projects \
 && mkdir -p /root/.maestro/data && chmod 755 /root/.maestro /root/.maestro/data \
 && chmod 755 /root/.claude

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

# Make setup script callable as "init"
RUN chmod +x packages/server/scripts/setup.sh \
 && ln -s /app/packages/server/scripts/setup.sh /usr/local/bin/init

EXPOSE 4800

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4800

CMD ["pnpm", "--filter", "server", "exec", "tsx", "src/main.ts"]
