# ForgeCommunity

<div align="center">

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748)](https://www.prisma.io/)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/storminator89/forgeCommunity/pulls)
[![Code Style](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io/)

<h3 align="center">🚀 Building the Future of Community Learning</h3>

[Report Bug](https://github.com/storminator89/forgeCommunity/issues) · [Request Feature](https://github.com/storminator89/forgeCommunity/issues)

</div>

## 📋 Table of Contents
- [About](#about)
  - [Why ForgeCommunity?](#why-forgecommunity)
  - [Built With](#built-with)
- [Features](#features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Usage](#usage)
- [Development](#development)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [License](#license)
- [Contact](#contact)
- [Acknowledgments](#acknowledgments)

## 🎯 About

ForgeCommunity is a comprehensive platform designed to foster learning, collaboration, and community engagement. It provides a space for users to access courses, participate in events, and connect with other community members.

### Why ForgeCommunity?

- 🤝 **Community-Driven**: Built by the community, for the community
- 📚 **Comprehensive Learning**: Structured courses and knowledge sharing
- 🔄 **Real-time Collaboration**: Interactive features for immediate engagement
- 🎯 **Goal-Oriented**: Focus on practical skills and measurable outcomes
- 🛡️ **Secure & Scalable**: Built with modern, secure technologies

![Start Screen](screens/usermanaagement.png)
![Wissensdatenbank](screens/knowlegdebase.png)

### Built With

Our tech stack combines modern technologies for optimal performance and developer experience:

#### Frontend
- 🔷 Next.js 16 (App Router)
- 📘 TypeScript
- 🎨 Tailwind CSS
- 🧩 Shadcn UI Components

#### Backend & Database
- 🗄️ Prisma ORM
- 🔐 NextAuth.js
- 📦 PostgreSQL

#### Tools & Utilities
- 📝 Tiptap Editor
- 🎯 DND Kit
- 📅 date-fns
- 🔄 Axios
- 🎨 Lucide React Icons

## ✨ Features

### Core Functionality
- **🏠 Home Dashboard**
  - Activity feed
  - Quick access to recent content

- **👥 Community Features**
  - Member profiles and networking
  - Discussion forums
  - Collaboration spaces

- **📚 Learning Resources**
  - Structured courses
  - Interactive tutorials
  - Progress tracking
  - Certificate generation

- **📅 Event Management**
  - Event creation and registration
  - Calendar integration

### Additional Features
- **🔍 Advanced Search**: Search across all content
- **💬 Real-time Chat**: Direct messaging and group chats
- **🔔 Smart Notifications**: Customizable notification preferences
- **📚 Knowledge Base**: Searchable documentation and resources
- **🛠️ Project Management**: Tools for collaborative projects
- **🎯 Skills Tracking**: Competency management system
- **🎓 Certificate Verification**: Digital credential validation

## 🚀 Getting Started

### Prerequisites

Ensure you have installed:
- Node.js 24 LTS (use the version declared in `.nvmrc`)
- npm 11 or later; use the committed `package-lock.json`
- Git (v2.0.0 or higher)
- Docker uses SQLite by default; PostgreSQL (v14 or higher) is available as an explicit deployment option

### Installation

1. Clone the repository:
```bash
git clone https://github.com/storminator89/forgeCommunity.git
cd forgeCommunity
```

2. **Install dependencies**
   ```bash
   npm ci
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   ```
   Configure your `.env` file:
   ```env
   DATABASE_PROVIDER="sqlite"
   DATABASE_URL="file:$PWD/data/forge.db"
   NEXTAUTH_SECRET="<generate with: openssl rand -base64 32>"
   NEXTAUTH_URL="http://localhost:3013"
   ```

4. **Database Setup**
   ```bash
   npm run db:generate
   npm run db:deploy
   ALLOW_DEMO_SEED=true npm run db:seed  # Optional; disposable development DB only
   ```

## 💻 Development

```bash
# Start development server
npm run dev

```

## 🚀 Deployment

SQLite ist der Standard für Docker: ein einzelner App-Container, eine persistente
SQLite-Datei und benannte Upload-Volumes. PostgreSQL bleibt als explizite Option
für bestehende oder skalierte Installationen verfügbar.

```bash
cp .env.example .env
# In .env mindestens einen starken NEXTAUTH_SECRET setzen.
docker compose up --build -d --wait
docker compose ps
```

Die Standarddatei `docker-compose.yml` baut das SQLite-Image und verwendet
`file:/app/data/forge.db`. Die Datenbank liegt im Volume `sqlite_data` und bleibt
bei einer normalen Neuerstellung des Containers erhalten. `docker compose down
--volumes` **löscht** die Volumes und damit die Daten. Für Backups Schreibzugriffe
stoppen und die SQLite-Datei inklusive Journal sichern oder die SQLite-Online-
Backup-API verwenden.

Der SQLite-Container wendet die versionierten Migrationen vor dem Serverstart
transaktional und idempotent an. Er legt keine Demo-Konten an. Die Compose-Datei
`docker-compose.sqlite.yml` bleibt als kompatibler Alias erhalten.

Für PostgreSQL die separate Datei verwenden:

```bash
cp .env.example .env
# In .env POSTGRES_PASSWORD sowie NEXTAUTH_SECRET setzen.
docker compose -f docker-compose.postgresql.yml up --build -d
```

Das PostgreSQL-Compose-Setup verändert das Schema beim Start nicht. Für eine
bestehende Installation zuerst die geprüfte Migration ausführen:

```bash
DATABASE_PROVIDER=postgresql \
DATABASE_URL="postgresql://forge:<passwort>@localhost:5432/forge?schema=public" \
npm run db:deploy
```

Für eine frische Entwicklungsdatenbank nach `prisma db push` muss einmalig die
verifizierte Baseline gesetzt werden:

```bash
npm run db:deploy -- --baseline-current-schema
```

Der PostgreSQL-Runner prüft Tabellen, Schlüssel, Prüfsummen und das URL-Schema;
unbekannte oder manipulierte Strukturen werden abgelehnt. Im Container kann der
Runner mit `docker compose -f docker-compose.postgresql.yml run --rm app node
scripts/db-deploy.mjs` ausgeführt werden. PostgreSQL und Upload-Volumes vor
Upgrades sichern und das Upgrade zunächst in einer Staging-Kopie testen.

Für lokale SQLite-Entwicklung ohne Docker den Provider **vor der Installation**
setzen, damit Prisma den passenden Client erzeugt:

```bash
export DATABASE_PROVIDER=sqlite
export DATABASE_URL="file:$PWD/data/forge.db"
cp .env.example .env  # Set a local NEXTAUTH_SECRET; shell DB vars take precedence.
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

Nach Änderungen an `prisma/schema.prisma` `npm run db:generate` ausführen. Der
Befehl regeneriert `prisma/schema.sqlite.prisma` und den ausgewählten Prisma
Client. SQLite-Schemaänderungen benötigen zusätzlich eine geprüfte, nummerierte
SQL-Datei in `prisma/sqlite-migrations/`. Der SQLite-Runner wendet diese Dateien
transaktional an und verweigert veränderte Prüfsummen oder eine bestehende
Datenbank ohne Migrationshistorie. Bereits angewendete Migrationen nicht ändern.
PostgreSQL verwendet die separat versionierten `prisma/postgresql-upgrades/`-
Dateien und den beschriebenen Deployment-Befehl.

SQLite eignet sich für eine einzelne Anwendung auf einem lokalen persistenten Dateisystem.
Keine Netzwerkfreigaben als Datenbankpfad und keine mehreren Container mit derselben
Datei verwenden. Case-insensitive Matching in SQLite ist bei Nicht-ASCII weiterhin
begrenzt. Für einen lokalen Produktionsbuild `DATABASE_PROVIDER=sqlite` sowohl
für `npm run build` als auch zur Laufzeit setzen, anschließend `npm run db:deploy`
und `npm run start` ausführen.

## 🤝 Contributing

We welcome contributions! See our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch
   ```bash
   git checkout -b feature/AmazingFeature
   ```
3. Commit your changes
   ```bash
   git commit -m 'Add some AmazingFeature'
   ```
4. Push to the branch
   ```bash
   git push origin feature/AmazingFeature
   ```
5. Open a Pull Request

## 🧪 Testing

```bash
# Run unit tests
npm run test

# Check application types
npm run typecheck

# Check lint and production build
npm run lint
npm run build

# Check known package vulnerabilities
npm audit
```

## 📁 Project Structure

```
forgeCommunity/
├── app/                # Next.js app directory
├── components/         # Reusable components
├── lib/               # Utility functions
├── prisma/            # Database schema and migrations
├── public/            # Static assets
└── tests/             # Test files
```

## 🗺️ Roadmap

- [ ] Mobile application
- [ ] AI-powered learning recommendations
- [ ] Advanced analytics dashboard

## 📄 License

This project is licensed under the Apache License, Version 2.0.

## 🙏 Acknowledgments

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS](https://tailwindcss.com)
- [Prisma](https://www.prisma.io)
- [Shadcn UI](https://ui.shadcn.com)
- [TypeScript](https://www.typescriptlang.org)

## Security modernization and upgrade notes

See [the audit and validation report](docs/SECURITY-MODERNIZATION.md) for the
baseline findings, migration details, test results, and remaining limitations.

For an existing installation:

1. Back up PostgreSQL and uploaded files; rehearse the upgrade against a staging copy.
2. Rotate `NEXTAUTH_SECRET` on deployment. This invalidates all old sessions,
   including any claims forged before the session update fix. Users must log in again.
3. Configure the canonical HTTPS `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`.
4. Use a strong database password. Never use the example connection string unchanged.
5. Only run `prisma db push` on a disposable development database. Plan and review
   PostgreSQL production schema migrations separately; no PostgreSQL production
   migration runs automatically on startup. SQLite startup applies its tracked
   SQL migrations.

Demo seeding requires `ALLOW_DEMO_SEED=true`, is refused in production, and creates
independent random passwords that are not printed. Demo accounts cannot be used
as a production login mechanism. Uploaded files require persistent storage in a
container deployment and a backup policy. Legacy public chat image paths are blocked
until their files and database references have been migrated to private storage.

## Repository audit (26 September 2026)

See [the repository audit](docs/REPOSITORY-AUDIT-2026-09-26.md) for confirmed findings, fixes, remaining functional gaps, and validation. Upgrading invalidates old authentication tokens; users must sign in again.
