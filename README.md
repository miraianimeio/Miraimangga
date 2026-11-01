# Mirai Anime (Hikari)

A modern, high-performance anime streaming and discovery platform featuring multi-provider catalog aggregation, intelligent stream health probing, WebCrypto client authentication, and a clean ES module frontend.

---

## ✨ Features

- **Multi-Provider Data Layer:** Seamlessly aggregates metadata across **AniList** (GraphQL catalog spine), **MyAnimeList** (v2 REST scores, rankings, studios), and **Jikan** (v4 character & voice actor fallbacks).
- **Intelligent Stream Probing:** Probes multiple streaming providers in parallel on the server side (`/api/server-check-all`), replacing client cross-origin checks with sub-second health status.
- **Built-in Security:**
  - Strict static asset isolation denying access to dotfiles and server code.
  - Escaping by construction: an `html` tagged template literal escapes every interpolation by default, with an explicit `raw()` opt-out.
  - PBKDF2-SHA256 password hashing with 210,000 rounds and unique per-user salts.
- **Modern ES Modules:** Zero build steps, zero transpilers, zero bundlers—runs natively in all modern web browsers.
- **In-Memory Caching:** Server-side TTL cache for catalog and stream-probe responses, with LRU eviction and single-flight de-duplication so concurrent misses share one upstream call.
- **Offline Shell & PWA:** Service Worker (v12) pre-caches UI shells for fast repeat visits.

---

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) v18.0.0 or higher.

### 2. Install & Launch
```bash
# From the project directory (no git remote is configured yet)
cd hikari

# Install dependencies
npm install

# Setup environment
cp .env.example .env

# Run local development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> [!IMPORTANT]
> Go through the server — do **not** open `public/home.html` directly from disk.
> The frontend uses native ES modules and calls `/api` as a same-origin path;
> neither works over `file://`, so the page will come up blank.

Sanity-check a change before reloading (there is no build step to catch a bad
import path for you):

```bash
npm run check   # parses every JS file, resolves every import, verifies asset refs
```

---

## 📖 Documentation

Complete project documentation is available in the [`docs/`](docs/README.md) directory:

- **[Project Structure Transitioning](docs/transition-from-downloads.md):** Detailed analysis of how the project transitioned from its original flat state in `downloads/hikari` to its current architecture, addressing security audits, monolithic decomposition, and MAL integration.
- **[System Architecture](docs/architecture.md):** Deep dive into the backend service, data normalization, caching strategy, and streaming architecture.
- **[API Reference](docs/api-reference.md):** Full specification of all `/api/catalog/*`, `/api/server-check*`, and `/api/manga` endpoints.
- **[Frontend Architecture](docs/frontend-architecture.md):** Breakdown of ES modules (`core/`, `features/`, `pages/`), security primitives, and state management.
- **[Setup & Deployment Guide](docs/setup-and-deployment.md):** Environment configuration, reverse proxy setup (Nginx), and production best practices.

---

## 📁 Project Structure

```
hikari/
├── docs/                       # Project documentation
│   ├── README.md               # Docs index
│   ├── transition-from-downloads.md # Structural transition documentation
│   ├── architecture.md         # System architecture
│   ├── api-reference.md        # REST API reference
│   ├── frontend-architecture.md# Frontend architecture & security
│   └── setup-and-deployment.md # Setup & deployment
│
├── server/                     # Backend application (Express)
│   ├── config.js               # Environment config loader
│   ├── index.js                # Server entrypoint & security middleware
│   ├── lib/                    # Cache, HTTP client, and data normalizers
│   ├── providers/              # AniList, MyAnimeList, and Jikan clients
│   └── routes/                 # Catalog, streaming, and manga routes
│
└── public/                     # Public web root
    ├── *.html                  # Clean semantic HTML pages
    ├── assets/                 # Curated graphics, favicons, logos
    ├── css/                    # Modular stylesheets
    ├── js/                     # Frontend ES modules (core, features, pages)
    └── service-worker.js       # PWA offline cache worker
```

---

## 📜 License
Private application.
