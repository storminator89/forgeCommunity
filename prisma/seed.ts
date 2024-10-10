import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  // Erstellen von Beispiel-Benutzern
  const hashedPassword = await bcrypt.hash('password123', 10)

  const user1 = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      email: 'alice@example.com',
      name: 'Alice',
      password: hashedPassword,
      role: 'USER',
    },
  })

  const user2 = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      email: 'bob@example.com',
      name: 'Bob',
      password: hashedPassword,
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