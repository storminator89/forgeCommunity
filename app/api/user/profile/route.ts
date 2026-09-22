import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/options'

// GET-Handler für das Abrufen des Benutzerprofils
export async function GET() {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user?.id) {
            return NextResponse.json(
                { error: 'Nicht autorisiert' },
                { status: 401 }
            )
        }

        const user = await prisma.user.findUnique({
            where: {
                id: session.user.id
            },
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                userSettings: {
                    select: {
                        language: true,
                        emailNotifications: true,
                        pushNotifications: true,
                    }
                }
            }
        })

        if (!user) {
            return NextResponse.json(
                { error: 'Benutzer nicht gefunden' },
                { status: 404 }
            )
        }

        return NextResponse.json(user)

    } catch (error) {
        console.error('Fehler beim Abrufen des Benutzerprofils:', error)
        return NextResponse.json(
            { error: 'Interner Serverfehler' },
            { status: 500 }
        )
    }
}

// PUT-Handler für das Aktualisieren des Benutzerprofils
export async function PUT(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user?.id) {
            return NextResponse.json(
                { error: 'Nicht autorisiert' },
                { status: 401 }
            )
        }

        const data = await request.json()
        const name = data.name === undefined
            ? undefined
            : typeof data.name === 'string' ? data.name.trim() : ''
        const email = data.email === undefined
            ? undefined
            : typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''

        if (name === '' || email === '') {
            return NextResponse.json(
                { error: 'Name und E-Mail sind erforderlich' },
                { status: 400 }
            )
        }

        const existingUser = email
            ? await prisma.user.findFirst({
                where: {
                    email: { equals: email, mode: 'insensitive' },
                    NOT: { id: session.user.id },
                },
                select: { id: true },
            })
            : null

        const currentSessionEmail = typeof session.user.email === 'string'
            ? session.user.email.trim().toLowerCase()
            : null
        const emailChanged = email !== undefined &&
            (currentSessionEmail === null || email !== currentSessionEmail)

        if (existingUser) {
            return NextResponse.json(
                { error: 'Diese E-Mail-Adresse wird bereits verwendet' },
                { status: 409 }
            )
        }

        // Aktualisieren des Benutzers
        const updatedUser = await prisma.user.update({
            where: {
                id: session.user.id
            },
            data: {
                name,
                email,
                image: data.image,
                ...(emailChanged && {
                    // A new address must complete verification again. Do not
                    // carry the old address' verified/recovery claims over.
                    emailVerified: null,
                    verificationToken: null,
                    resetPasswordToken: null,
                }),
                userSettings: {
                    upsert: {
                        create: {
                            language: data.language,
                            emailNotifications: data.emailNotifications,
                            pushNotifications: data.pushNotifications,
                        },
                        update: {
                            language: data.language,
                            emailNotifications: data.emailNotifications,
                            pushNotifications: data.pushNotifications,
                        }
                    }
                }
            },
            // Never return the full User row here: it contains the password
            // hash and account recovery tokens.
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                userSettings: {
                    select: {
                        language: true,
                        emailNotifications: true,
                        pushNotifications: true,
                    }
                }
            }
        })

        const safeUser = {
            id: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email,
            image: updatedUser.image,
            userSettings: updatedUser.userSettings,
        }

        return NextResponse.json(safeUser)

    } catch (error) {
        console.error('Fehler beim Aktualisieren des Benutzerprofils:', error)
        return NextResponse.json(
            { error: 'Interner Serverfehler' },
            { status: 500 }
        )
    }
}
