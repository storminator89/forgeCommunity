import { render, screen } from '@testing-library/react'
import { NotificationBadge } from '@/components/notification-badge'

// Mock the NotificationContext
const mockUseNotifications = jest.fn()
jest.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => mockUseNotifications(),
}))

describe('NotificationBadge', () => {
  beforeEach(() => {
    // Clear mock before each test
    mockUseNotifications.mockClear()
  })

  it('renders nothing when unreadCount is 0', () => {
    mockUseNotifications.mockReturnValue({ unreadCount: 0 })
    
    const { container } = render(<NotificationBadge />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the exact count when less than 100', () => {
    mockUseNotifications.mockReturnValue({ unreadCount: 5 })
    
    render(<NotificationBadge />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders "99+" when count is greater than 99', () => {
    mockUseNotifications.mockReturnValue({ unreadCount: 100 })
    
    render(<NotificationBadge />)
    expect(screen.getByText('99+')).toBeInTheDocument()
  })

  it('applies custom className correctly', () => {
    mockUseNotifications.mockReturnValue({ unreadCount: 1 })
    const customClass = 'custom-class'
    
    render(<NotificationBadge className={customClass} />)
    const badge = screen.getByText('1')
    expect(badge).toHaveClass(customClass)
    expect(badge).toHaveClass('bg-destructive')
    expect(badge).toHaveClass('text-destructive-foreground')
  })

  it('handles undefined className gracefully', () => {
    mockUseNotifications.mockReturnValue({ unreadCount: 1 })
    
    render(<NotificationBadge />)
    const badge = screen.getByText('1')
    expect(badge).toHaveClass('bg-destructive')
    expect(badge).toHaveClass('text-destructive-foreground')
  })
})
