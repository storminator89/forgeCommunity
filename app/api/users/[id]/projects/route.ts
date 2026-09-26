import { PaginationError, readPagination } from '@/lib/server/pagination';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../auth/[...nextauth]/options";
import { HttpUrlValidationError, normalizeHttpUrl } from '@/lib/server/url-security';
import { getSafeHttpUrl } from '@/lib/security';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';
import { sanitizeRichHtmlServer, sanitizeTextServer } from '@/lib/server/sanitize-html';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Nicht authentifiziert' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const { page, limit, skip } = readPagination(searchParams, 6);

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
    const formattedProjects = projects.map(project => {
      const safeLink = getSafeHttpUrl(project.link);
      return ({
      id: project.id,
      title: project.title,
      description: project.description,
      imageUrl: project.imageUrl,
      link: safeLink ?? '',
      githubUrl: safeLink && new URL(safeLink).hostname.toLowerCase() === 'github.com' ? safeLink : null,
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
      });
    });

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
    if (error instanceof PaginationError) return NextResponse.json({ error: error.message }, { status: 400 });
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
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || (session.user.id !== params.id && session.user.role !== 'ADMIN')) {
      return NextResponse.json(
        { error: 'Nicht autorisiert' },
        { status: 401 }
      );
    }

    const data = await readJsonObject(request);

    // Validiere die erforderlichen Felder
    if (typeof data.title !== 'string' || typeof data.description !== 'string' || typeof data.link !== 'string') {
      return NextResponse.json(
        { error: 'Titel, Beschreibung und Link sind erforderlich' },
        { status: 400 }
      );
    }
    const title = sanitizeTextServer(data.title);
    const description = sanitizeRichHtmlServer(data.description);
    const category = data.category == null ? null : typeof data.category === 'string' ? sanitizeTextServer(data.category) : null;
    const imageUrl = data.imageUrl == null || data.imageUrl === '' ? null : typeof data.imageUrl === 'string' ? data.imageUrl : null;
    const tags = data.tags == null ? [] : data.tags;
    const gradientFrom = data.gradientFrom == null ? '#4F46E5' : data.gradientFrom;
    const gradientTo = data.gradientTo == null ? '#9333EA' : data.gradientTo;
    if (!title || !sanitizeTextServer(description) || !data.link.trim() || title.length > 300 || description.length > 100_000 ||
      (data.category != null && (typeof data.category !== 'string' || !category || category.length > 100)) ||
      (data.imageUrl != null && data.imageUrl !== '' && (typeof data.imageUrl !== 'string' || (!imageUrl?.startsWith('/images/uploads/') && !getSafeHttpUrl(imageUrl ?? '')))) ||
      !Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || !sanitizeTextServer(tag) || sanitizeTextServer(tag).length > 60) ||
      typeof gradientFrom !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(gradientFrom) ||
      typeof gradientTo !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(gradientTo)) {
      return NextResponse.json({ error: 'Ungültige Projektdaten' }, { status: 400 });
    }

    let link: string;
    try {
      // This legacy JSON endpoint feeds the public profile/showcase links.
      // Keep its URL policy identical to the multipart project endpoint so a
      // caller cannot persist javascript:, data:, or file: URLs.
      link = normalizeHttpUrl(data.link).toString();
    } catch (error) {
      if (error instanceof HttpUrlValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // Erstelle das Projekt
    const project = await prisma.project.create({
      data: {
        title,
        description,
        link,
        imageUrl,
        category,
        gradientFrom,
        gradientTo,
        author: {
          connect: { id: params.id }
        },
        tags: {
          connectOrCreate: (tags as string[]).map((tag) => ({
            where: { name: sanitizeTextServer(tag) },
            create: { name: sanitizeTextServer(tag) }
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
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    return NextResponse.json(
      { error: 'Fehler beim Erstellen des Projekts' },
      { status: 500 }
    );
  }
}
