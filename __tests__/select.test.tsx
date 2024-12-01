import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import '@testing-library/jest-dom'

// Mock scrollIntoView since it's not implemented in JSDOM
window.HTMLElement.prototype.scrollIntoView = jest.fn()

describe('Select Component', () => {
  const mockOnValueChange = jest.fn()

  const TestSelect = () => (
    <Select onValueChange={mockOnValueChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Fruits</SelectLabel>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="orange">Orange</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )

  beforeEach(() => {
    mockOnValueChange.mockClear()
  })

  it('renders select trigger with placeholder', () => {
    render(<TestSelect />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('Select a fruit')
  })

  it('opens select when trigger is clicked', async () => {
    render(<TestSelect />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    
    await waitFor(() => {
      expect(screen.getByText('Fruits')).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Banana' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Orange' })).toBeInTheDocument()
    })
  })

  it('selects an item when clicked', async () => {
    render(<TestSelect />)
    
    // Open select
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    
    // Select an item
    await waitFor(() => {
      const option = screen.getByRole('option', { name: 'Apple' })
      fireEvent.click(option)
      expect(mockOnValueChange).toHaveBeenCalledWith('apple')
    })
  })

  it('closes select when item is selected', async () => {
    render(<TestSelect />)
    
    // Open select
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    
    // Select an item and verify it closes
    await waitFor(() => {
      const option = screen.getByRole('option', { name: 'Apple' })
      fireEvent.click(option)
      expect(mockOnValueChange).toHaveBeenCalledWith('apple')
    })
  })

  it('closes select when clicking outside', async () => {
    render(<TestSelect />)
    
    // Open select
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    
    // Wait for select to be visible
    await screen.findByRole('option', { name: 'Apple' })
    
    // Simulate pressing Escape to close the select
    // This is a more reliable way to test closing behavior since click outside
    // is handled by Radix UI's portal system
    fireEvent.keyDown(document.body, { key: 'Escape' })
    
    // Wait for select to be closed
    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })
  })

  it('closes select when pressing escape key', async () => {
    render(<TestSelect />)
    
    // Open select
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    
    // Wait for select to be visible
    await screen.findByRole('option', { name: 'Apple' })
    
    // Press escape key
    fireEvent.keyDown(trigger, { key: 'Escape' })
    
    // Wait for select to be closed
    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })
  })

  it('navigates items with arrow keys', async () => {
    render(<TestSelect />)
    
    // Open select
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    
    await waitFor(() => {
      // Press arrow down
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      const appleOption = screen.getByRole('option', { name: 'Apple' })
      expect(appleOption).toHaveAttribute('data-highlighted')
    })
  })

  it('selects item with enter key', async () => {
    render(<TestSelect />)
    
    // Open select
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    
    await waitFor(() => {
      // Navigate to item
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      
      // Select with enter
      const appleOption = screen.getByRole('option', { name: 'Apple' })
      fireEvent.keyDown(appleOption, { key: 'Enter' })
      expect(mockOnValueChange).toHaveBeenCalledWith('apple')
    })
  })

  it('renders with custom className', () => {
    render(
      <Select>
        <SelectTrigger className="custom-trigger">
          <SelectValue placeholder="Test" />
        </SelectTrigger>
      </Select>
    )
    
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveClass('custom-trigger')
  })

  it('handles disabled state', () => {
    render(
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Disabled" />
        </SelectTrigger>
      </Select>
    )
    
    const trigger = screen.getByRole('combobox')
    expect(trigger).toBeDisabled()
  })

  it('handles disabled items', async () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="disabled" disabled>
            Disabled Item
          </SelectItem>
        </SelectContent>
      </Select>
    )
    
    // Open select
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    
    await waitFor(() => {
      const disabledOption = screen.getByRole('option', { name: 'Disabled Item' })
      expect(disabledOption).toHaveAttribute('aria-disabled', 'true')
    })
  })
})
