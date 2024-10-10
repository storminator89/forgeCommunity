import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json()

    // Überprüfen, ob der Benutzer bereits existiert
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json({ message: 'E-Mail-Adresse wird bereits verwendet.' }, { status: 400 })
    }

    // Passwort hashen
    const hashedPassword = await bcrypt.hash(password, 10)

    // Neuen Benutzer erstellen
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    })

    return NextResponse.json({ message: 'Benutzer erfolgreich registriert.', userId: user.id }, { status: 201 })
  } catch (error) {
    console.error('Registrierungsfehler:', error)
    return NextResponse.json({ message: 'Interner Serverfehler' }, { status: 500 })
  }
}