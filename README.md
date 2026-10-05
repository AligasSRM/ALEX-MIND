# ALEX MIND

Central control and memory architecture for ALEX.

## Architecture

ALEX MIND separates sources, vaults, projects, knowledge, synchronization, and storage providers.

```
ALEX MIND
├── core/
├── vaults/
│   ├── phone/
│   ├── work/
│   └── archive/
├── sources/
│   ├── gmail/
│   ├── outlook-hotmail/
│   ├── github/
│   ├── cloudflare/
│   ├── backblaze/
│   └── idrive/
├── projects/
│   ├── alex-bitcoin/
│   ├── xkiss/
│   ├── ac-assist-center/
│   ├── style-looks/
│   └── mahmoud-cv/
├── inbox/
├── knowledge/
├── sync/
├── storage/
├── mobile/
└── docs/
```

## Principles

- Sources remain independent.
- Cloudflare is the central control/index layer.
- Vaults remain separated by purpose.
- Storage providers are replaceable.
- No public deployment is required for the core project.
- Secrets and credentials are never committed.
