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
- PostgreSQL (v14 or higher)

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
   DATABASE_URL="postgresql://user:password@localhost:5432/forge"
   NEXTAUTH_SECRET="<generate with: openssl rand -base64 32>"
   NEXTAUTH_URL="http://localhost:3013"
   ```

4. **Database Setup**
   ```bash
   npx prisma generate
   npx prisma db push
   ALLOW_DEMO_SEED=true npm run db:seed  # Optional; disposable development DB only
   ```

## 💻 Development

```bash
# Start development server
npm run dev

```

## 🚀 Deployment

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Start production server**
   ```bash
   npm run start
   ```

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
   production schema migrations separately; no production migration is run by this branch.

Demo seeding requires `ALLOW_DEMO_SEED=true`, is refused in production, and creates
independent random passwords that are not printed. Demo accounts cannot be used
as a production login mechanism. Uploaded files require persistent storage in a
container deployment and a backup policy. Legacy public chat image paths are blocked
until their files and database references have been migrated to private storage.
