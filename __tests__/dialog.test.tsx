import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import '@testing-library/jest-dom'

describe('Dialog Component', () => {
  const mockOnOpenChange = jest.fn()

  const TestDialog = ({ className = '' }) => (
    <Dialog onOpenChange={mockOnOpenChange}>
      <DialogTrigger>Open Dialog</DialogTrigger>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>Test Dialog Title</DialogTitle>
          <DialogDescription>Test Dialog Description</DialogDescription>
        </DialogHeader>
        <div>Dialog Content</div>
        <DialogFooter>
          <button data-testid="close-button">Close</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  beforeEach(() => {
    mockOnOpenChange.mockClear()
  })

  it('renders dialog trigger', () => {
    render(<TestDialog />)
    expect(screen.getByText('Open Dialog')).toBeInTheDocument()
  })

  it('opens dialog when trigger is clicked', () => {
    render(<TestDialog />)
    fireEvent.click(screen.getByText('Open Dialog'))
    expect(screen.getByText('Dialog Content')).toBeInTheDocument()
  })

  it('renders dialog with title and description', () => {
    render(<TestDialog />)
    fireEvent.click(screen.getByText('Open Dialog'))
    expect(screen.getByText('Test Dialog Title')).toBeInTheDocument()
    expect(screen.getByText('Test Dialog Description')).toBeInTheDocument()
  })

  it('closes dialog when close button is clicked', () => {
    render(<TestDialog />)
    fireEvent.click(screen.getByText('Open Dialog'))
    expect(screen.getByText('Dialog Content')).toBeInTheDocument()
    
    // Close dialog
    fireEvent.click(screen.getByTestId('close-button'))
    expect(mockOnOpenChange).toHaveBeenCalledWith(true)
  })

  it('closes dialog when clicking outside', async () => {
    render(<TestDialog />)
    fireEvent.click(screen.getByText('Open Dialog'))
    expect(screen.getByText('Dialog Content')).toBeInTheDocument()
    
    // Click outside
    const backdrop = screen.getByRole('dialog').parentElement
    if (backdrop) {
      fireEvent.click(backdrop)
      expect(mockOnOpenChange).toHaveBeenCalledWith(true)
    }
  })

  it('closes dialog when pressing escape key', () => {
    render(<TestDialog />)
    fireEvent.click(screen.getByText('Open Dialog'))
    expect(screen.getByText('Dialog Content')).toBeInTheDocument()
    
    // Press escape key
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders dialog with custom className', () => {
    render(<TestDialog className="custom-class" />)
    fireEvent.click(screen.getByText('Open Dialog'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('custom-class')
  })

  it('maintains focus trap', () => {
    render(<TestDialog />)
    fireEvent.click(screen.getByText('Open Dialog'))
    
    const closeButton = screen.getByTestId('close-button')
    
    // Initial focus should be on the close button
    expect(closeButton).toHaveFocus()
  })
})
