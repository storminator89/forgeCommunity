// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Mock NextResponse
const NextResponse = {
  json: (body, init = {}) => {
    const response = new Response(JSON.stringify(body), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    })
    
    // Add status and ok properties
    Object.defineProperty(response, 'status', {
      get() { return init.status || 200 }
    })
    Object.defineProperty(response, 'ok', {
      get() { return response.status >= 200 && response.status < 300 }
    })

    // Add json method
    response.json = async () => body

    return response
  }
}

global.NextResponse = NextResponse

// Mock FormData
class FormData {
  constructor() {
    this.data = new Map()
  }

  append(key, value) {
    this.data.set(key, value)
  }

  get(key) {
    return this.data.get(key)
  }

  entries() {
    return Array.from(this.data.entries())
  }
}

global.FormData = FormData

// Mock fetch globally
global.fetch = jest.fn()

// Setup Request and Response constructors for Next.js API routes
if (typeof Request !== 'function') {
  global.Request = class Request {
    constructor(input, init) {
      this.url = input
      this.method = init?.method || 'GET'
      this._body = init?.body
      this.headers = new Map(Object.entries(init?.headers || {}))
    }

    async formData() {
      if (this._body instanceof FormData) {
        return this._body
      }
      throw new Error('Body is not FormData')
    }
  }
}

if (typeof Response !== 'function') {
  global.Response = class Response {
    constructor(body, init = {}) {
      this._body = body
      this.status = init.status || 200
      this.ok = this.status >= 200 && this.status < 300
      this.headers = new Map(Object.entries(init.headers || {}))
    }

    async json() {
      return typeof this._body === 'string' ? JSON.parse(this._body) : this._body
    }
  }
}
