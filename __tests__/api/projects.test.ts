import { GET, POST } from '@/app/api/projects/route'
import prisma from '@/lib/prisma'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

// Mock the dependencies
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init?: ResponseInit) => {
      const response = new Response(JSON.stringify(body), {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {})
        }
      })
      
      // Add status and ok properties
      Object.defineProperty(response, 'status', {
        get() { return init?.status || 200 }
      })
      Object.defineProperty(response, 'ok', {
        get() { return response.status >= 200 && response.status < 300 }
      })

      // Add json method
      response.json = async () => body

      return response
    }
  }
}))

jest.mock('@/lib/prisma', () => ({
  project: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  tag: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
}))

jest.mock('next-auth/next', () => ({
  getServerSession: jest.fn(),
}))

jest.mock('@/lib/auth', () => ({
  authOptions: {},
}))

// Mock random gradient colors to be consistent
const mockGradientFrom = '#d96852'
const mockGradientTo = '#b738c7'
jest.mock('@/lib/utils', () => ({
  getRandomGradient: () => ({
    from: mockGradientFrom,
    to: mockGradientTo,
  }),
}))

describe('Projects API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /api/projects', () => {
    it('should return all projects', async () => {
      const mockProjects = [
        { 
          id: 1, 
          title: 'Project 1',
          author: {
            id: 1,
            name: 'Test User',
            image: 'test.jpg'
          },
          tags: [],
          likes: [],
          comments: []
        },
      ]

      ;(prisma.project.findMany as jest.Mock).mockResolvedValueOnce(mockProjects)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual(mockProjects)
      expect(prisma.project.findMany).toHaveBeenCalledWith({
        include: {
          author: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          tags: {
            select: {
              id: true,
              name: true,
            },
          },
          likes: true,
          comments: {
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })
    })

    it('should handle database errors', async () => {
      ;(prisma.project.findMany as jest.Mock).mockRejectedValueOnce(new Error('Database error'))

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({ error: 'Fehler beim Abrufen der Projekte.' })
    })
  })

  describe('POST /api/projects', () => {
    const mockProject = {
      title: 'New Project',
      description: 'Project description',
      category: 'Test Category',
      tags: 'tag1,tag2',
      link: 'https://example.com',
    }

    it('should create a new project when authenticated', async () => {
      const mockTags = [
        { id: 1, name: 'tag1' },
        { id: 2, name: 'tag2' }
      ]

      const createdProject = { 
        id: 1,
        ...mockProject,
        imageUrl: '',
        gradientFrom: mockGradientFrom,
        gradientTo: mockGradientTo,
        author: {
          id: 1,
          name: 'Test User',
          image: 'test.jpg'
        },
        tags: mockTags,
        likes: [],
        comments: []
      }

      ;(getServerSession as jest.Mock).mockResolvedValueOnce({ 
        user: { 
          id: 1,
          name: 'Test User',
          email: 'test@test.com'
        } 
      })

      // Mock tag lookups
      ;(prisma.tag.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockTags[0])
        .mockResolvedValueOnce(mockTags[1])

      ;(prisma.project.create as jest.Mock).mockResolvedValueOnce(createdProject)

      const formData = new FormData()
      Object.entries(mockProject).forEach(([key, value]) => {
        formData.append(key, value)
      })

      const request = new Request('http://localhost:3000/api/projects', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data).toEqual(createdProject)
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: {
          title: mockProject.title,
          description: mockProject.description,
          category: mockProject.category,
          link: mockProject.link,
          imageUrl: '',
          gradientFrom: mockGradientFrom,
          gradientTo: mockGradientTo,
          author: {
            connect: { id: 1 }
          },
          tags: {
            connect: mockTags.map(tag => ({ id: tag.id }))
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
          tags: {
            select: {
              id: true,
              name: true,
            },
          },
          likes: true,
          comments: true,
        },
      })
    })

    it('should return 401 when not authenticated', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValueOnce(null)

      const formData = new FormData()
      Object.entries(mockProject).forEach(([key, value]) => {
        formData.append(key, value)
      })

      const request = new Request('http://localhost:3000/api/projects', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: 'Nicht authentifiziert.' })
      expect(prisma.project.create).not.toHaveBeenCalled()
    })

    it('should handle missing required fields', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValueOnce({ 
        user: { 
          id: 1,
          name: 'Test User',
          email: 'test@test.com'
        } 
      })

      const formData = new FormData()
      formData.append('title', 'Test Project')
      formData.append('tags', '') // Add empty tags to prevent null error

      const request = new Request('http://localhost:3000/api/projects', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: 'Titel, Beschreibung, Kategorie und Link sind erforderlich.' })
    })

    it('should handle database errors during creation', async () => {
      ;(getServerSession as jest.Mock).mockResolvedValueOnce({ 
        user: { 
          id: 1,
          name: 'Test User',
          email: 'test@test.com'
        } 
      })

      const formData = new FormData()
      Object.entries(mockProject).forEach(([key, value]) => {
        formData.append(key, value)
      })

      ;(prisma.project.create as jest.Mock).mockRejectedValueOnce(new Error('Database error'))

      const request = new Request('http://localhost:3000/api/projects', {
        method: 'POST',
        body: formData
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({ error: 'Fehler beim Erstellen des Projekts.' })
    })
  })
})
