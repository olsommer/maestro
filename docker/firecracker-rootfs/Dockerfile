FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  coreutils \
  curl \
  docker.io \
  git \
  gh \
  iproute2 \
  iptables \
  mount \
  npm \
  nodejs \
  procps \
  python3 \
  python3-pip \
  rsync \
  socat \
  util-linux \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code @openai/codex

COPY docker/firecracker-rootfs/maestro-guest-init.sh /usr/local/bin/maestro-guest-init.sh
COPY docker/firecracker-rootfs/maestro-login-shell.sh /usr/local/bin/maestro-login-shell.sh

RUN chmod +x /usr/local/bin/maestro-guest-init.sh /usr/local/bin/maestro-login-shell.sh \
  && mkdir -p /workspace /var/run /var/log
