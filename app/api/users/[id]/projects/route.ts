import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '6');
    const skip = (page - 1) * limit;

    // Hole Projekte mit Pagination
    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where: {
          authorId: params.id
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          tags: true,
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
          likes: {
            where: {
              userId: session.user.id
            },
            take: 1
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: limit,
      }),
      prisma.project.count({
        where: {
          authorId: params.id
        }
      })
    ]);

    // Formatiere die Projekte für die Response
    const formattedProjects = projects.map(project => ({
      id: project.id,
      title: project.title,
      description: project.description,
      imageUrl: project.imageUrl,
      link: project.link,
      githubUrl: project.link.includes('github.com') ? project.link : null,
      category: project.category,
      gradientFrom: project.gradientFrom,
      gradientTo: project.gradientTo,
      tags: project.tags.map(tag => tag.name),
      author: {
        id: project.author.id,
        name: project.author.name,
        image: project.author.image,
      },
      stats: {
        likes: project._count.likes,
        comments: project._count.comments,
      },
      isLiked: project.likes.length > 0,
      createdAt: project.createdAt,
    }));

    return NextResponse.json({
      projects: formattedProjects,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        currentPage: page,
        hasMore: skip + projects.length < total
      }
    });

  } catch (error) {
    console.error('Error fetching user projects:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Projekte' },
      { status: 500 }
    );
  }
}

// POST-Route zum Erstellen eines neuen Projekts
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || (session.user.id !== params.id && session.user.role !== 'ADMIN')) {
      return NextResponse.json(
        { error: 'Nicht autorisiert' },
        { status: 401 }
      );
    }

    const data = await request.json();

    // Validiere die erforderlichen Felder
    if (!data.title || !data.description || !data.link) {
      return NextResponse.json(
        { error: 'Titel, Beschreibung und Link sind erforderlich' },
        { status: 400 }
      );
    }

    // Erstelle das Projekt
    const project = await prisma.project.create({
      data: {
        title: data.title,
        description: data.description,
        link: data.link,
        imageUrl: data.imageUrl,
        category: data.category,
        gradientFrom: data.gradientFrom || '#4F46E5',
        gradientTo: data.gradientTo || '#9333EA',
        author: {
          connect: { id: params.id }
        },
        tags: {
          connectOrCreate: data.tags.map((tag: string) => ({
            where: { name: tag },
            create: { name: tag }
          }))
        }
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        tags: true,
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      project: {
        ...project,
        tags: project.tags.map(tag => tag.name),
        stats: {
          likes: project._count.likes,
          comments: project._count.comments,
        },
        isLiked: false,
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Fehler beim Erstellen des Projekts' },
      { status: 500 }
    );
  }
}