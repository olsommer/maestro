# Maestro

Server-based agent orchestration platform. Spawn, manage, and coordinate AI coding agents through a web interface with a Kanban board, super agent, and automation engine.

## Architecture

Maestro separates the **frontend** from the **server**. In the common setup, users share one public frontend and each run their own backend on their own machine. Self-hosting the frontend is optional.

```
                    ┌──────────────────────────────────────────┐
                    │  Shared Frontend (Next.js)               │
                    │  Hosted once on a frontend host          │
                    │  Self-hosting is optional                │
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
2. Exposes it via a secure HTTPS URL (Tailscale, Cloudflare Tunnel, Caddy, etc.)
3. Opens the shared frontend, or a self-hosted frontend, and enters their backend URL + API token
4. Gets their own isolated agent environment

Public shared frontend:
`https://maestro-beige.vercel.app`

## Quick Start (Local Development)

This section is for developing Maestro itself. For normal use, users only need to run their own backend and connect to it from the shared frontend.

The deployed shared frontend is available at `https://maestro-beige.vercel.app`.

Maestro currently requires Node.js `22.13.0` or newer because the server uses the built-in `node:sqlite` module.

```bash
# Install dependencies
pnpm install

# Start the server (port 4800)
pnpm dev:server

# Start the client (port 3000)
pnpm dev:client
```

On first run the server generates an API token at `~/.maestro/token`.
Open `http://localhost:3000`, enter `http://localhost:4800` as the server URL, paste the token, and connect.

## Deployment

### Frontend (Optional)

Most users do not need to deploy the frontend. They can use an existing shared frontend and point it at their own backend.

Shared frontend URL:
`https://maestro-beige.vercel.app`

Deploy your own frontend only if you want a custom host, custom branding, or a fully self-hosted setup.

**Vercel (Recommended)**

```bash
cd packages/client
vercel deploy --prod
```

No frontend secrets are required. The connect page lets each user enter their own backend URL at runtime.

### Server (Per-User — Runs on Each User's Machine)

Each user runs their own server instance. The server holds their API token, agents, and project data.

**Bare Metal**

```bash
# Node.js 22.13.0+ required
pnpm install
NODE_ENV=production pnpm dev:server
```

The API token is printed on first run and stored at `~/.maestro/token`.

Bare-metal deployment does not require Docker for the Maestro server itself.

- Maestro-owned state lives under `~/.maestro/`
- managed projects live under `~/.maestro/projects/`
- sandbox state lives under `~/.maestro/sandboxes/`
- Docker is only needed if you want Docker sandboxing for agents and terminals

If you want a globally installed package instead of a repo checkout:

```bash
nvm install 22
nvm use 22
npm i -g @isarai/maestro
maestro onboard
maestro start
maestro status
maestro logs
maestro logs -f
maestro auth
maestro version
maestro update --check
maestro stop
```

## Remote Access (Exposing Your Server)

The server listens on plain HTTP. For remote access, put a TLS-terminating layer in front of it. **Never expose port 4800 directly to the internet.**

If you already use Tailscale, that is enough. You do not need to self-host the frontend or set up a separate public tunnel provider just to use Maestro remotely.

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

# Serve the backend over HTTPS via Tailscale (run on the server)
tailscale serve --bg http://localhost:4800
```

This makes the server available at `https://<machine-name>.<tailnet>.ts.net` with automatic TLS — no port number needed (port 443 proxies to localhost:4800). The `--bg` flag runs it in the background.

To find your full MagicDNS hostname:

```bash
tailscale status --json | grep MagicDNSSuffix
```

This returns your tailnet suffix (e.g. `tail7dbfac.ts.net`). Combine it with your machine name from `tailscale status` to get the full URL:

```
https://<machine-name>.<tailnet>.ts.net
```

If the browser shows a certificate error, open the URL directly in the browser first to accept the cert, or regenerate it:

```bash
tailscale cert <machine-name>.<tailnet>.ts.net
```

Connect from the client using the full `https://<machine-name>.<tailnet>.ts.net` URL as the server URL.

Note: Tailscale requires the Tailscale app on every connecting device.

## Authentication

Maestro uses a **"bring your own backend"** model. There is no central auth server — each user's server is its own auth authority.

**How it works:**
1. Server generates a static API token on first start → `~/.maestro/token` (permissions `0600`)
2. User opens the shared frontend → connect page asks for server URL + API token
3. Frontend stores both in `localStorage`
4. HTTP requests include `Authorization: Bearer <token>`
5. Socket.io connections pass the token in `socket.handshake.auth.token`
6. On `401`, the client redirects back to the connect page

**Security model:**
- The frontend has no secrets — it's safe to host publicly
- Each server only accepts its own API token — users can't access each other's servers
- All traffic goes through the user's tunnel (HTTPS) — the server never handles TLS directly
- The current client uses the API token directly; the server also exposes `POST /api/auth/token` for exchanging it into a 24h JWT if needed by other clients

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4800` | Server listen port |
| `HOST` | `0.0.0.0` | Server bind address |
| `AUTH_DISABLED` | — | Set to `1` to disable auth (dev only) |
| `GITHUB_TOKEN` | — | GitHub API token for integrations |
| `GH_TOKEN` | — | Alternative GitHub token variable |

## Project Structure

```
maestro/
├── packages/
│   ├── server/   # Fastify API + Socket.io + PTY + agents
│   ├── client/   # Next.js web interface
│   ├── wire/     # Shared Zod schemas & types
│   └── mcp/      # MCP orchestrator for super agent
└── pnpm-workspace.yaml
```
