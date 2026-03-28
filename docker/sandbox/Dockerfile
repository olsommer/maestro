FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates curl gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && . /etc/os-release \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y \
    bash \
    build-essential \
    bubblewrap \
    docker-ce-cli \
    docker-compose-plugin \
    gh \
    git \
    python-is-python3 \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm
RUN npm install -g @anthropic-ai/claude-code @openai/codex

RUN mkdir -p /root/.claude \
 && echo '{"hasCompletedOnboarding":true}' > /root/.claude.json

WORKDIR /workspace

ENV TERM=xterm-256color

CMD ["/bin/bash", "-l"]
