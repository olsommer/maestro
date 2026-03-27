# @isarai/maestro

Standalone CLI for running Maestro without Docker Compose.

The Maestro server runs directly on the host. Docker is optional and only needed if you enable Docker sandboxing for agents or terminals.

## Install

```bash
npm i -g @isarai/maestro
```

## Usage

```bash
maestro start
maestro status
maestro logs
maestro logs -f
maestro auth
maestro version
maestro update --check
maestro update
maestro stop
```
