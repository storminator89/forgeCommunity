import { render, screen, fireEvent } from '@testing-library/react'
import { CategorySelect } from '@/components/CategorySelect'

// Mock UI components
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, variant }: { 
    children: React.ReactNode; 
    onClick?: () => void; 
    disabled?: boolean;
    variant?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>{children}</button>
  ),
}))

jest.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder }: { 
    value: string; 
    onChange: (e: any) => void; 
    placeholder: string 
  }) => (
    <input 
      value={value} 
      onChange={onChange} 
      placeholder={placeholder}
      data-testid="category-input"
    />
  ),
}))

jest.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

describe('CategorySelect', () => {
  const mockProps = {
    categories: ['Blog', 'Tutorial', 'News', 'Event'],
    selectedCategory: 'Blog',
    setSelectedCategory: jest.fn(),
    onAddCategory: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders with initial category selected', () => {
    render(<CategorySelect {...mockProps} />)
    
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('Blog')
    expect(screen.getByText('Kategorie')).toBeInTheDocument()
  })

  it('renders all categories in dropdown', () => {
    render(<CategorySelect {...mockProps} />)
    
    mockProps.categories.forEach(category => {
      expect(screen.getByText(category)).toBeInTheDocument()
    })
  })

  it('calls setSelectedCategory when a category is selected', () => {
    render(<CategorySelect {...mockProps} />)
    
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'Tutorial' } })
    
    expect(mockProps.setSelectedCategory).toHaveBeenCalledWith('Tutorial')
  })

  it('shows add new category form when "Neu" button is clicked', () => {
    render(<CategorySelect {...mockProps} />)
    
    const newButton = screen.getByText('Neu')
    fireEvent.click(newButton)
    
    expect(screen.getByTestId('category-input')).toBeInTheDocument()
    expect(screen.getByText('Hinzufügen')).toBeInTheDocument()
    expect(screen.getByText('Abbrechen')).toBeInTheDocument()
  })

  it('allows adding a new category', () => {
    render(<CategorySelect {...mockProps} />)
    
    // Click "Neu" button to show input
    fireEvent.click(screen.getByText('Neu'))
    
    // Enter new category
    const input = screen.getByTestId('category-input')
    fireEvent.change(input, { target: { value: 'NewCategory' } })
    
    // Click add button
    fireEvent.click(screen.getByText('Hinzufügen'))
    
    expect(mockProps.onAddCategory).toHaveBeenCalledWith('NewCategory')
  })

  it('does not add empty or existing categories', () => {
    render(<CategorySelect {...mockProps} />)
    
    // Click "Neu" button to show input
    fireEvent.click(screen.getByText('Neu'))
    
    // Try to add empty category
    const input = screen.getByTestId('category-input')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Hinzufügen'))
    expect(mockProps.onAddCategory).not.toHaveBeenCalled()
    
    // Try to add existing category
    fireEvent.change(input, { target: { value: 'Blog' } })
    fireEvent.click(screen.getByText('Hinzufügen'))
    expect(mockProps.onAddCategory).not.toHaveBeenCalled()
  })

  it('cancels adding new category', () => {
    render(<CategorySelect {...mockProps} />)
    
    // Click "Neu" button to show input
    fireEvent.click(screen.getByText('Neu'))
    
    // Enter some text
    const input = screen.getByTestId('category-input')
    fireEvent.change(input, { target: { value: 'NewCategory' } })
    
    // Click cancel
    fireEvent.click(screen.getByText('Abbrechen'))
    
    // Check if we're back to selection view
    expect(screen.queryByTestId('category-input')).not.toBeInTheDocument()
    expect(screen.getByText('Neu')).toBeInTheDocument()
    expect(mockProps.onAddCategory).not.toHaveBeenCalled()
  })

  it('clears input when cancelling', () => {
    render(<CategorySelect {...mockProps} />)
    
    // Click "Neu" button to show input
    fireEvent.click(screen.getByText('Neu'))
    
    // Enter some text
    const input = screen.getByTestId('category-input')
    fireEvent.change(input, { target: { value: 'NewCategory' } })
    
    // Click cancel
    fireEvent.click(screen.getByText('Abbrechen'))
    
    // Show form again
    fireEvent.click(screen.getByText('Neu'))
    
    // Check if input is empty
    const newInput = screen.getByTestId('category-input')
    expect(newInput).toHaveValue('')
  })

  it('shows placeholder text in dropdown when no category is selected', () => {
    render(
      <CategorySelect 
        {...mockProps} 
        selectedCategory=""
      />
    )
    
    expect(screen.getByText('Wähle eine Kategorie...')).toBeInTheDocument()
  })
})
