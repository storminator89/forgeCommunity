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

        // Aktualisieren des Benutzers
        const updatedUser = await prisma.user.update({
            where: {
                id: session.user.id
            },
            data: {
                name: data.name,
                email: data.email,
                image: data.image,
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
            include: {
                userSettings: true
            }
        })

        return NextResponse.json(updatedUser)

    } catch (error) {
        console.error('Fehler beim Aktualisieren des Benutzerprofils:', error)
        return NextResponse.json(
            { error: 'Interner Serverfehler' },
            { status: 500 }
        )
    }
}
