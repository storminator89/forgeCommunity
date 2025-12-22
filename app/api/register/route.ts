import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import bcrypt from 'bcrypt'
import { z } from 'zod'

const registerSchema = z.object({
  name: z.string().min(1, "Name ist erforderlich"),
  email: z.string().email("Ungültige E-Mail-Adresse"),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen lang sein"),
})

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const result = registerSchema.safeParse(json)

    if (!result.success) {
      return NextResponse.json(
        { message: result.error.errors[0].message },
        { status: 400 }
      )
    }

    const { name, email, password } = result.data

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