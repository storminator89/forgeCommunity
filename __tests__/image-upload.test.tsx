import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImageUpload } from '@/components/ImageUpload'
import { toast } from 'react-toastify'

// Mock the dependencies
jest.mock('react-toastify', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}))

// Mock next/image
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, className }: { src: string; alt: string; className: string }) => (
    <img src={src} alt={alt} className={className} />
  ),
}))

// Mock fetch
const mockFetch = jest.fn()
global.fetch = mockFetch

// Mock components
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

describe('ImageUpload', () => {
  const mockOnImageUpdate = jest.fn()
  
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks()
    mockFetch.mockClear()
    mockOnImageUpdate.mockClear()
  })

  it('renders with placeholder image when no current image is provided', () => {
    render(<ImageUpload onImageUpdate={mockOnImageUpdate} />)
    const img = screen.getByAltText('Profilbild')
    expect(img).toHaveAttribute('src', '/images/placeholder.png')
  })

  it('renders with current image when provided', () => {
    const currentImage = '/images/test.jpg'
    render(<ImageUpload currentImage={currentImage} onImageUpdate={mockOnImageUpdate} />)
    const img = screen.getByAltText('Profilbild')
    expect(img).toHaveAttribute('src', currentImage)
  })

  it('shows error toast when file is too large', async () => {
    render(<ImageUpload onImageUpdate={mockOnImageUpdate} />)
    
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 }) // 6MB
    
    const input = screen.getByRole('button')
    fireEvent.click(input)
    
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    
    expect(toast.error).toHaveBeenCalledWith('Die Datei ist zu groß. Maximale Größe ist 5MB.')
  })

  it('shows error toast when file type is invalid', async () => {
    render(<ImageUpload onImageUpdate={mockOnImageUpdate} />)
    
    const file = new File([''], 'test.txt', { type: 'text/plain' })
    
    const input = screen.getByRole('button')
    fireEvent.click(input)
    
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    
    expect(toast.error).toHaveBeenCalledWith('Ungültiger Dateityp. Nur JPEG, PNG und GIF sind erlaubt.')
  })

  it('handles successful file upload', async () => {
    const mockResponse = { filePath: '/images/uploaded.jpg' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })

    render(<ImageUpload onImageUpdate={mockOnImageUpdate} />)
    
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }) // 1MB
    
    const input = screen.getByRole('button')
    fireEvent.click(input)
    
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
      expect(mockOnImageUpdate).toHaveBeenCalledWith(mockResponse.filePath)
      expect(toast.success).toHaveBeenCalledWith('Bild erfolgreich hochgeladen!')
    })
  })

  it('handles upload error', async () => {
    const errorMessage = 'Upload failed'
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: errorMessage }),
    })

    render(<ImageUpload onImageUpdate={mockOnImageUpdate} />)
    
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }) // 1MB
    
    const input = screen.getByRole('button')
    fireEvent.click(input)
    
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(errorMessage)
    })
  })

  it('disables button during upload', async () => {
    // Mock a slow upload
    mockFetch.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)))

    render(<ImageUpload onImageUpdate={mockOnImageUpdate} />)
    
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }) // 1MB
    
    const button = screen.getByRole('button')
    fireEvent.click(button)
    
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    
    expect(button).toHaveTextContent('Wird hochgeladen...')
    expect(button).toBeDisabled()
  })
})
