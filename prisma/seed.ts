import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL must be configured before running the seed.')
}
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seed is disabled in production.');
  }
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Set ALLOW_DEMO_SEED=true explicitly for a disposable development database.');
  }
  // Demo accounts have independent, undisclosed random credentials.
  const alicePassword = await bcrypt.hash(randomBytes(32).toString('base64url'), 12)
  const bobPassword = await bcrypt.hash(randomBytes(32).toString('base64url'), 12)

  const user1 = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      email: 'alice@example.com',
      name: 'Alice',
      password: alicePassword,
      role: 'USER',
    },
  })

  const user2 = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      email: 'bob@example.com',
      name: 'Bob',
      password: bobPassword,
      role: 'USER',
    },
  })

  // Erstellen von Beispiel-Posts
  const post1 = await prisma.post.create({
    data: {
      title: 'Erster Beitrag',
      content: 'Dies ist der Inhalt des ersten Beitrags.',
      published: true,
      authorId: user1.id,
    },
  })

  const post2 = await prisma.post.create({
    data: {
      title: 'Zweiter Beitrag',
      content: 'Dies ist der Inhalt des zweiten Beitrags.',
      published: true,
      authorId: user2.id,
    },
  })

  // Erstellen von Beispiel-Kommentaren
  await prisma.comment.createMany({
    data: [
      {
        content: 'Großartiger Beitrag!',
        postId: post1.id,
        authorId: user2.id,
      },
      {
        content: 'Danke für die Informationen.',
        postId: post2.id,
        authorId: user1.id,
      },
    ],
  })

  // Erstellen von Beispiel-Kursen
  await prisma.course.create({
    data: {
      title: 'Einführung in Web-Entwicklung',
      description: 'Lernen Sie die Grundlagen der Web-Entwicklung.',
      instructorId: user1.id,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 Tage ab jetzt
    },
  })

  console.log('Seed-Daten wurden erfolgreich eingefügt.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
