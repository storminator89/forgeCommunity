import { render, screen, fireEvent } from '@testing-library/react'
import { TagSelect } from '@/components/TagSelect'

// Mock UI components
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

jest.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder }: { value: string; onChange: (e: any) => void; placeholder: string }) => (
    <input 
      value={value} 
      onChange={onChange} 
      placeholder={placeholder}
      data-testid="tag-input"
    />
  ),
}))

jest.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}))

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <div data-testid="tag-badge">{children}</div>,
}))

describe('TagSelect', () => {
  const mockProps = {
    availableTags: ['React', 'TypeScript', 'Next.js', 'TailwindCSS', 'Jest'],
    selectedTags: ['React'],
    onTagSelect: jest.fn(),
    onTagRemove: jest.fn(),
    onAddTag: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders with initial tags', () => {
    render(<TagSelect {...mockProps} />)
    
    // Check if selected tag is rendered
    expect(screen.getByText('React')).toBeInTheDocument()
    
    // Check if select element contains available unselected tags
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Tag auswählen...')).toBeInTheDocument()
  })

  it('allows selecting a tag from dropdown', () => {
    render(<TagSelect {...mockProps} />)
    
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'TypeScript' } })
    
    expect(mockProps.onTagSelect).toHaveBeenCalledWith('TypeScript')
  })

  it('allows removing a selected tag', () => {
    render(<TagSelect {...mockProps} />)
    
    const removeButton = screen.getByText('×')
    fireEvent.click(removeButton)
    
    expect(mockProps.onTagRemove).toHaveBeenCalledWith('React')
  })

  it('disables tag selection when max tags are reached', () => {
    const props = {
      ...mockProps,
      selectedTags: ['React', 'TypeScript', 'Next.js', 'TailwindCSS', 'Jest'],
    }
    
    render(<TagSelect {...props} />)
    
    const select = screen.getByRole('combobox')
    expect(select).toBeDisabled()
    
    const newButton = screen.getByText('Neu')
    expect(newButton).toBeDisabled()
  })

  it('shows add new tag form when "Neu" button is clicked', () => {
    render(<TagSelect {...mockProps} />)
    
    const newButton = screen.getByText('Neu')
    fireEvent.click(newButton)
    
    expect(screen.getByTestId('tag-input')).toBeInTheDocument()
    expect(screen.getByText('Hinzufügen')).toBeInTheDocument()
    expect(screen.getByText('Abbrechen')).toBeInTheDocument()
  })

  it('allows adding a new tag', () => {
    render(<TagSelect {...mockProps} />)
    
    // Click "Neu" button to show input
    fireEvent.click(screen.getByText('Neu'))
    
    // Enter new tag
    const input = screen.getByTestId('tag-input')
    fireEvent.change(input, { target: { value: 'NewTag' } })
    
    // Click add button
    fireEvent.click(screen.getByText('Hinzufügen'))
    
    expect(mockProps.onAddTag).toHaveBeenCalledWith('NewTag')
  })

  it('does not add empty or existing tags', () => {
    render(<TagSelect {...mockProps} />)
    
    // Click "Neu" button to show input
    fireEvent.click(screen.getByText('Neu'))
    
    // Try to add empty tag
    const input = screen.getByTestId('tag-input')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Hinzufügen'))
    expect(mockProps.onAddTag).not.toHaveBeenCalled()
    
    // Try to add existing tag
    fireEvent.change(input, { target: { value: 'React' } })
    fireEvent.click(screen.getByText('Hinzufügen'))
    expect(mockProps.onAddTag).not.toHaveBeenCalled()
  })

  it('cancels adding new tag', () => {
    render(<TagSelect {...mockProps} />)
    
    // Click "Neu" button to show input
    fireEvent.click(screen.getByText('Neu'))
    
    // Enter some text
    const input = screen.getByTestId('tag-input')
    fireEvent.change(input, { target: { value: 'NewTag' } })
    
    // Click cancel
    fireEvent.click(screen.getByText('Abbrechen'))
    
    // Check if we're back to selection view
    expect(screen.queryByTestId('tag-input')).not.toBeInTheDocument()
    expect(screen.getByText('Neu')).toBeInTheDocument()
  })

  it('filters out selected tags from available options', () => {
    render(<TagSelect {...mockProps} />)
    
    // React should not be in the dropdown as it's already selected
    const select = screen.getByRole('combobox')
    const options = Array.from(select.getElementsByTagName('option'))
    const optionTexts = options.map(option => option.textContent)
    
    expect(optionTexts).not.toContain('React')
    expect(optionTexts).toContain('TypeScript')
  })
})
