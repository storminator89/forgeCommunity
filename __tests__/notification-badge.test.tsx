import { render, screen } from '@testing-library/react'
import { NotificationBadge } from '@/components/notification-badge'

// Mock the NotificationContext
const mockUseNotifications = jest.fn()
jest.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => mockUseNotifications(),
}))

// Mock the Badge component
jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="badge" className={className}>{children}</div>
  ),
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
    expect(screen.getByTestId('badge')).toHaveTextContent('5')
  })

  it('renders "99+" when count is greater than 99', () => {
    mockUseNotifications.mockReturnValue({ unreadCount: 100 })
    
    render(<NotificationBadge />)
    expect(screen.getByTestId('badge')).toHaveTextContent('99+')
  })

  it('applies custom className correctly', () => {
    mockUseNotifications.mockReturnValue({ unreadCount: 1 })
    const customClass = 'custom-class'
    
    render(<NotificationBadge className={customClass} />)
    const badge = screen.getByTestId('badge')
    expect(badge).toHaveClass(customClass)
    expect(badge).toHaveClass('bg-red-500')
    expect(badge).toHaveClass('text-white')
  })

  it('handles undefined className gracefully', () => {
    mockUseNotifications.mockReturnValue({ unreadCount: 1 })
    
    render(<NotificationBadge />)
    const badge = screen.getByTestId('badge')
    expect(badge).toHaveClass('bg-red-500')
    expect(badge).toHaveClass('text-white')
  })
})
