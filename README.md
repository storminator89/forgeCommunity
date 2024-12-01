# ForgeCommunity

<div align="center">

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5-2D3748)](https://www.prisma.io/)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/yourusername/forgeCommunity/pulls)
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
- 🔷 Next.js 14 (App Router)
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
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher) or yarn (v1.22.0 or higher)
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
   npm install
   # or
   yarn install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   ```
   Configure your `.env` file:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/forge"
   NEXTAUTH_SECRET="your-secret-key"
   NEXTAUTH_URL="http://localhost:3000"
   ```

4. **Database Setup**
   ```bash
   npx prisma generate
   npx prisma db push
   npm run db:seed  # Optional: Seed initial data
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

# Run integration tests
npm run test:integration

# Run e2e tests
npm run test:e2e
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
