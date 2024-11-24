import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { ThemeToggle } from '@/components/theme-toggle'

// Mock the ui components
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))

// Mock the dropdown menu
jest.mock('@/components/ui/dropdown-menu', () => {
  const DropdownMenuTrigger = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  const DropdownMenuContent = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  const DropdownMenuItem = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  )
  
  // Add displayName to components
  DropdownMenuTrigger.displayName = 'DropdownMenuTrigger'
  DropdownMenuContent.displayName = 'DropdownMenuContent'
  DropdownMenuItem.displayName = 'DropdownMenuItem'

  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
  }
})

// Mock next-themes
const mockSetTheme = jest.fn()
jest.mock('next-themes', () => ({
  useTheme: () => ({
    setTheme: mockSetTheme,
    theme: 'light',
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Sun: () => <div data-testid="sun-icon">Sun Icon</div>,
  Moon: () => <div data-testid="moon-icon">Moon Icon</div>,
}))

describe('ThemeToggle', () => {
  beforeEach(() => {
    // Clear mock before each test
    mockSetTheme.mockClear()
  })

  it('renders theme toggle button', () => {
    render(
      <NextThemesProvider>
        <ThemeToggle />
      </NextThemesProvider>
    )
    
    // Check if the button is rendered with icons
    expect(screen.getByText('Toggle theme')).toBeInTheDocument()
    expect(screen.getByTestId('sun-icon')).toBeInTheDocument()
    expect(screen.getByTestId('moon-icon')).toBeInTheDocument()
  })

  it('opens dropdown menu when clicked', () => {
    render(
      <NextThemesProvider>
        <ThemeToggle />
      </NextThemesProvider>
    )
    
    // Since we're mocking the Radix UI components, the menu items are always visible
    expect(screen.getByText('Light')).toBeInTheDocument()
    expect(screen.getByText('Dark')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
  })

  it('calls setTheme with correct theme when options are clicked', () => {
    render(
      <NextThemesProvider>
        <ThemeToggle />
      </NextThemesProvider>
    )
    
    // Click theme options and verify setTheme is called
    fireEvent.click(screen.getByText('Light'))
    expect(mockSetTheme).toHaveBeenCalledWith('light')
    
    fireEvent.click(screen.getByText('Dark'))
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
    
    fireEvent.click(screen.getByText('System'))
    expect(mockSetTheme).toHaveBeenCalledWith('system')
  })
})
