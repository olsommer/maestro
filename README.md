# Maestro

Server-based agent orchestration platform. Spawn, manage, and coordinate AI coding agents through a web interface with a Kanban board, super agent, and automation engine.

## Architecture

Maestro separates the **frontend** (shared, hosted publicly) from the **server** (runs on each user's own machine). The frontend contains no secrets — it's a static app that asks each user where their server lives.

```
                    ┌──────────────────────────────────────────┐
                    │  Shared Frontend (Next.js)               │
                    │  Hosted once — Vercel, Cloudflare Pages, │
                    │  or any static host                      │
                    │  No secrets, no server logic             │
                    └─────────┬───────────────┬────────────────┘
                              │               │
                       User A's URL      User B's URL
                       + API token       + API token
                              │               │
                              ▼               ▼
                    ┌───────────────────┐  ┌───────────────────┐
                    │  Tunnel (User A)  │  │  Tunnel (User B)  │
                    │  Cloudflare / etc │  │  Cloudflare / etc │
                    └────────┬──────────┘  └────────┬──────────┘
                             │                      │
                             ▼                      ▼
                    ┌───────────────────┐  ┌───────────────────┐
                    │  Server (User A)  │  │  Server (User B)  │
                    │  localhost:4800   │  │  localhost:4800   │
                    │  Their machine    │  │  Their machine    │
                    └───────────────────┘  └───────────────────┘
```

Each user:
1. Runs the Maestro server on their own machine
2. Exposes it via a tunnel (Cloudflare Tunnel, Tailscale, etc.)
3. Opens the shared frontend and enters their tunnel URL + API token
4. Gets their own isolated agent environment

## Quick Start (Local Development)

```bash
# Install dependencies
pnpm install

# Start the server (port 4800)
pnpm dev:server

# Start the client (port 3000)
pnpm dev:client
```

On first run the server generates an API token at `~/.maestro/api-token`.
Open `http://localhost:3000`, enter `http://localhost:4800` as the server URL, paste the token, and connect.

## Deployment

### Frontend (Hosted — Shared for All Users)

The Next.js client is a static app with no server-side secrets. Host it once, everyone uses it.

**Vercel (Recommended)**

```bash
cd packages/client
vercel deploy --prod
```

No environment variables required — the connect page lets each user enter their own server URL at runtime.

**Cloudflare Pages**

```bash
cd packages/client
pnpm build
# Upload .next/out or use Cloudflare Pages Git integration
```

**Self-hosted (nginx/Caddy)**

```bash
cd packages/client
pnpm build
# Serve .next/standalone or use `pnpm start` behind a reverse proxy
```

### Server (Per-User — Runs on Each User's Machine)

Each user runs their own server instance. The server holds their API token, agents, and project data.

**Option 1: Docker**

```bash
docker compose up -d
```

Data persists in Docker volumes:
- `maestro_data` — API token, JWT secret, SQLite state (`~/.maestro/`)
- `maestro_projects` — cloned project directories
- `ollama_data` — Ollama models and runtime state

Retrieve your API token:

```bash
docker compose exec server cat /root/.maestro/api-token
```

The Docker stack also starts an `ollama` service on `http://localhost:11434`.
Inside the Compose network, the server can reach it at `http://ollama:11434` via
the default `OLLAMA_HOST` environment variable.

After the stack is up, pull the model you want once:

```bash
docker compose exec ollama ollama pull llama3.2
```

You can list installed models with:

```bash
docker compose exec ollama ollama list
```

Models persist in `ollama_data`, so you usually only need to pull them once per
machine or Docker volume.

**Option 2: Bare Metal**

```bash
pnpm install
NODE_ENV=production pnpm dev:server
```

The API token is printed on first run and stored at `~/.maestro/api-token`.

## Remote Access (Exposing Your Server)

The server listens on plain HTTP. For remote access, put a TLS-terminating layer in front of it. **Never expose port 4800 directly to the internet.**

### Cloudflare Tunnel (Recommended)

Zero open ports, free, no TLS certs to manage. Cloudflare creates an outbound-only connection from your machine.

```bash
# 1. Install cloudflared
brew install cloudflared          # macOS
# curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared  # Linux

# 2. Authenticate (one-time)
cloudflared tunnel login

# 3. Create a tunnel
cloudflared tunnel create maestro

# 4. Configure it — create ~/.cloudflared/config.yml
cat <<'EOF' > ~/.cloudflared/config.yml
tunnel: maestro
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: maestro.yourdomain.com
    service: http://localhost:4800
  - service: http_status:404
EOF

# 5. Add DNS record (points hostname to tunnel)
cloudflared tunnel route dns maestro maestro.yourdomain.com

# 6. Run it
cloudflared tunnel run maestro
```

Then connect from the client using `https://maestro.yourdomain.com` as the server URL.

#### Quick Tunnel (No Domain Required)

For quick testing without a custom domain:

```bash
cloudflared tunnel --url http://localhost:4800
```

This gives you a temporary `https://<random>.trycloudflare.com` URL.

#### Run as a System Service

```bash
# macOS (launchd)
sudo cloudflared service install

# Linux (systemd)
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

### Docker + Cloudflare Tunnel

Add a `cloudflared` sidecar to `docker-compose.yml`:

```yaml
services:
  server:
    build: .
    depends_on:
      - ollama
    ports:
      - "4800:4800"
    environment:
      HOST: 0.0.0.0
      PORT: 4800
      GITHUB_TOKEN: ${GITHUB_TOKEN:-}
      GH_TOKEN: ${GH_TOKEN:-}
      OLLAMA_HOST: http://ollama:11434
    volumes:
      - maestro_data:/root/.maestro
      - maestro_projects:/root/maestro-projects

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama

  tunnel:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      - server
    restart: unless-stopped

volumes:
  maestro_data:
  maestro_projects:
  ollama_data:
```

Create the tunnel in the Cloudflare Zero Trust dashboard, point it to `http://server:4800`, and set `CLOUDFLARE_TUNNEL_TOKEN` in your `.env`.

### Caddy (Alternative — Auto-TLS)

If you have a public-facing server with ports 80/443 open, Caddy handles TLS certificates automatically:

```bash
# Install Caddy
brew install caddy   # macOS
# apt install caddy  # Debian/Ubuntu

# Create Caddyfile
cat <<'EOF' > Caddyfile
maestro.yourdomain.com {
    reverse_proxy localhost:4800
}
EOF

# Run
caddy run
```

### Tailscale (Alternative — Mesh VPN)

Access Maestro from any device with Tailscale installed. No public domain needed, no open ports.

```bash
# Install Tailscale
brew install tailscale   # macOS

# Start and authenticate
sudo tailscale up

# Optional: enable HTTPS with a MagicDNS cert
tailscale cert <machine-name>.<tailnet>.ts.net
```

Connect from the client using `http://<machine-name>:4800` (within the tailnet) or `https://<machine-name>.<tailnet>.ts.net:4800` with Tailscale HTTPS enabled.

Note: Tailscale requires the Tailscale app on every connecting device.

## Authentication

Maestro uses a **"bring your own backend"** model. There is no central auth server — each user's server is its own auth authority.

**How it works:**
1. Server generates a static API token on first start → `~/.maestro/api-token` (permissions `0600`)
2. User opens the shared frontend → connect page asks for server URL + API token
3. Frontend stores both in `localStorage` and includes `Authorization: Bearer <token>` on all requests
4. Socket.io connections pass the token in `socket.handshake.auth.token`
5. On `401`, the client redirects back to the connect page

**Security model:**
- The frontend has no secrets — it's safe to host publicly
- Each server only accepts its own API token — users can't access each other's servers
- All traffic goes through the user's tunnel (HTTPS) — the server never handles TLS directly
- Token exchange endpoint (`POST /api/auth/token`) converts the API token into a 24h JWT for session use

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4800` | Server listen port |
| `HOST` | `0.0.0.0` | Server bind address |
| `AUTH_DISABLED` | — | Set to `1` to disable auth (dev only) |
| `GITHUB_TOKEN` | — | GitHub API token for integrations |
| `GH_TOKEN` | — | Alternative GitHub token variable |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Cloudflare Tunnel token (Docker) |

## Project Structure

```
maestro/
├── packages/
│   ├── server/   # Fastify API + Socket.io + PTY + agents
│   ├── client/   # Next.js web interface
│   ├── wire/     # Shared Zod schemas & types
│   └── mcp/      # MCP orchestrator for super agent
├── docker-compose.yml
├── Dockerfile
└── pnpm-workspace.yaml
```
