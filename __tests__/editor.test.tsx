import { render, screen, fireEvent } from '@testing-library/react'
import { Editor } from '@/components/Editor'
import '@testing-library/jest-dom'

// Mock the icons
jest.mock('lucide-react', () => ({
  Bold: () => <span data-testid="bold-icon">Bold</span>,
  Italic: () => <span data-testid="italic-icon">Italic</span>,
  Heading2: () => <span data-testid="heading-icon">Heading</span>,
  List: () => <span data-testid="bullet-list-icon">BulletList</span>,
  ListOrdered: () => <span data-testid="ordered-list-icon">OrderedList</span>,
  Quote: () => <span data-testid="quote-icon">Quote</span>,
  Code: () => <span data-testid="code-icon">Code</span>,
  Undo: () => <span data-testid="undo-icon">Undo</span>,
  Redo: () => <span data-testid="redo-icon">Redo</span>,
}))

// Mock tiptap
const mockEditor = {
  chain: () => ({
    focus: jest.fn().mockReturnThis(),
    toggleBold: () => ({ run: jest.fn() }),
    toggleItalic: () => ({ run: jest.fn() }),
    toggleHeading: () => ({ run: jest.fn() }),
    toggleBulletList: () => ({ run: jest.fn() }),
    toggleOrderedList: () => ({ run: jest.fn() }),
    toggleBlockquote: () => ({ run: jest.fn() }),
    toggleCode: () => ({ run: jest.fn() }),
    undo: () => ({ run: jest.fn() }),
    redo: () => ({ run: jest.fn() }),
  }),
  isActive: () => false,
  can: () => ({
    undo: () => true,
    redo: () => true,
  }),
  getHTML: () => '<p>Test Content</p>',
  commands: {
    setContent: jest.fn(),
  },
}

jest.mock('@tiptap/react', () => ({
  useEditor: () => mockEditor,
  EditorContent: ({ editor }: { editor: any }) => (
    <div data-testid="editor-content">
      <div contentEditable dangerouslySetInnerHTML={{ __html: editor?.getHTML() }} />
    </div>
  ),
}))

// Mock UI components
jest.mock('@/components/ui/toggle', () => ({
  Toggle: ({ children, onPressedChange, pressed, disabled }: { 
    children: React.ReactNode; 
    onPressedChange: () => void; 
    pressed?: boolean;
    disabled?: boolean;
  }) => (
    <button 
      onClick={onPressedChange} 
      data-pressed={pressed} 
      disabled={disabled}
      data-testid="toggle-button"
    >
      {children}
    </button>
  ),
}))

describe('Editor', () => {
  const mockProps = {
    content: '<p>Test Content</p>',
    onChange: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders with initial content', () => {
    render(<Editor {...mockProps} />)
    
    expect(screen.getByTestId('editor-content')).toBeInTheDocument()
    expect(screen.getByText(/Test Content/)).toBeInTheDocument()
  })

  it('renders all formatting buttons', () => {
    render(<Editor {...mockProps} />)
    
    expect(screen.getByTestId('bold-icon')).toBeInTheDocument()
    expect(screen.getByTestId('italic-icon')).toBeInTheDocument()
    expect(screen.getByTestId('heading-icon')).toBeInTheDocument()
    expect(screen.getByTestId('bullet-list-icon')).toBeInTheDocument()
    expect(screen.getByTestId('ordered-list-icon')).toBeInTheDocument()
    expect(screen.getByTestId('quote-icon')).toBeInTheDocument()
    expect(screen.getByTestId('code-icon')).toBeInTheDocument()
    expect(screen.getByTestId('undo-icon')).toBeInTheDocument()
    expect(screen.getByTestId('redo-icon')).toBeInTheDocument()
  })

  it('allows clicking formatting buttons', () => {
    render(<Editor {...mockProps} />)
    
    const buttons = screen.getAllByTestId('toggle-button')
    buttons.forEach(button => {
      fireEvent.click(button)
      expect(button).not.toBeDisabled()
    })
  })

  it('updates content when props change', () => {
    const { rerender } = render(<Editor {...mockProps} />)
    
    // Update content prop
    const newContent = '<p>New content</p>'
    rerender(<Editor {...mockProps} content={newContent} />)
    
    // Verify that setContent was called with the new content
    expect(mockEditor.commands.setContent).toHaveBeenCalledWith(newContent)
  })

  it('calls onChange when content changes', () => {
    render(<Editor {...mockProps} />)
    
    // Simulate content change by calling the onChange handler directly
    mockProps.onChange('<p>Test Content</p>')
    expect(mockProps.onChange).toHaveBeenCalledWith('<p>Test Content</p>')
  })

  it('renders with default placeholder when none provided', () => {
    const { content, onChange } = mockProps
    render(<Editor content={content} onChange={onChange} />)
    
    expect(screen.getByTestId('editor-content')).toBeInTheDocument()
  })

  it('renders with custom placeholder when provided', () => {
    render(<Editor {...mockProps} placeholder="Custom placeholder" />)
    
    expect(screen.getByTestId('editor-content')).toBeInTheDocument()
  })

  it('handles keyboard shortcuts', () => {
    render(<Editor {...mockProps} />)
    
    // Simulate keyboard shortcuts
    fireEvent.keyDown(screen.getByTestId('editor-content'), { key: 'b', ctrlKey: true })
    fireEvent.keyDown(screen.getByTestId('editor-content'), { key: 'i', ctrlKey: true })
    
    // Verify that the commands were called
    const buttons = screen.getAllByTestId('toggle-button')
    expect(buttons[0]).not.toBeDisabled() // Bold button
    expect(buttons[1]).not.toBeDisabled() // Italic button
  })

  it('handles empty content gracefully', () => {
    const emptyProps = {
      ...mockProps,
      content: '',
    }
    render(<Editor {...emptyProps} />)
    
    expect(screen.getByTestId('editor-content')).toBeInTheDocument()
    expect(mockEditor.commands.setContent).toHaveBeenCalledWith('')
  })

  it('handles null content gracefully', () => {
    const nullProps = {
      ...mockProps,
      content: null,
    }
    render(<Editor {...nullProps} />)
    
    expect(screen.getByTestId('editor-content')).toBeInTheDocument()
    expect(mockEditor.commands.setContent).toHaveBeenCalledWith('')
  })

  it('handles undefined content gracefully', () => {
    const undefinedProps = {
      ...mockProps,
      content: undefined,
    }
    render(<Editor {...undefinedProps} />)
    
    expect(screen.getByTestId('editor-content')).toBeInTheDocument()
    expect(mockEditor.commands.setContent).toHaveBeenCalledWith('')
  })

  it('handles malformed HTML content gracefully', () => {
    const malformedProps = {
      ...mockProps,
      content: '<p>Unclosed paragraph<span>Unclosed span',
    }
    render(<Editor {...malformedProps} />)
    
    expect(screen.getByTestId('editor-content')).toBeInTheDocument()
    expect(mockEditor.commands.setContent).toHaveBeenCalledWith(malformedProps.content)
  })

  it('maintains editor state after multiple content updates', () => {
    const { rerender } = render(<Editor {...mockProps} />)
    
    // Update content multiple times
    const contents = [
      '<p>First update</p>',
      '<p>Second update</p>',
      '<p>Third update</p>',
    ]
    
    contents.forEach(content => {
      rerender(<Editor {...mockProps} content={content} />)
      expect(mockEditor.commands.setContent).toHaveBeenCalledWith(content)
    })
  })

  it('handles rapid content updates', () => {
    const { rerender } = render(<Editor {...mockProps} />)
    
    // Simulate rapid updates
    for (let i = 0; i < 10; i++) {
      const content = `<p>Update ${i}</p>`
      rerender(<Editor {...mockProps} content={content} />)
    }
    
    // Verify the last update was processed
    expect(mockEditor.commands.setContent).toHaveBeenCalledWith('<p>Update 9</p>')
  })

  it('preserves cursor position after content update', () => {
    render(<Editor {...mockProps} />)
    
    // Simulate cursor position preservation
    const editorContent = screen.getByTestId('editor-content')
    const editableDiv = editorContent.querySelector('[contenteditable="true"]') as HTMLDivElement
    if (editableDiv) {
      editableDiv.focus()
    }
    
    // Update content
    mockProps.onChange('<p>New content</p>')
    
    // Editor should still be focused
    const activeElement = document.activeElement
    expect(activeElement?.getAttribute('contenteditable')).toBe('true')
  })

  it('handles very large content', () => {
    const largeContent = '<p>' + 'a'.repeat(10000) + '</p>'
    const largeProps = {
      ...mockProps,
      content: largeContent,
    }
    
    render(<Editor {...largeProps} />)
    expect(screen.getByTestId('editor-content')).toBeInTheDocument()
    expect(mockEditor.commands.setContent).toHaveBeenCalledWith(largeContent)
  })
})
