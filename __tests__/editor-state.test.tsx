import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { Editor } from '@/components/Editor'

// Exercise real Tiptap transactions and real Radix toggles. The mocked editor
// tests cannot detect a toolbar that stops subscribing to selection/stored marks.
describe('Editor transaction state', () => {
  it('reflects a collapsed-caret bold toggle before any text is changed', async () => {
    const onChange = jest.fn()
    render(<Editor content="<p>Existing article text.</p>" onChange={onChange} />)
    const textbox = await screen.findByRole('textbox', { name: 'Text bearbeiten' })
    const editor = (textbox as HTMLElement & { editor: TiptapEditor }).editor
    const bold = screen.getByRole('button', { name: /^Fett$/ })

    act(() => { editor.commands.setTextSelection(1) })
    onChange.mockClear()
    expect(bold).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(bold)

    expect(editor.isActive('bold')).toBe(true)
    expect(editor.getHTML()).toBe('<p>Existing article text.</p>')
    expect(onChange).not.toHaveBeenCalled()
    expect(bold).toHaveAttribute('aria-pressed', 'true')

    act(() => { editor.commands.insertContent('Bold text. ') })
    expect(textbox.querySelector('strong')).toHaveTextContent('Bold text.')
    expect(onChange).toHaveBeenCalledWith('<p><strong>Bold text. </strong>Existing article text.</p>')
  })

  it('tracks formatting when the selection moves without changing content', async () => {
    const content = '<p><strong>Bold</strong> plain.</p>'
    const onChange = jest.fn()
    render(<Editor content={content} onChange={onChange} />)
    const textbox = await screen.findByRole('textbox', { name: 'Text bearbeiten' })
    const editor = (textbox as HTMLElement & { editor: TiptapEditor }).editor
    const bold = screen.getByRole('button', { name: /^Fett$/ })
    onChange.mockClear()

    act(() => { editor.commands.setTextSelection(1) })
    expect(bold).toHaveAttribute('aria-pressed', 'true')
    act(() => { editor.commands.setTextSelection(7) })
    expect(editor.isActive('bold')).toBe(false)
    expect(bold).toHaveAttribute('aria-pressed', 'false')
    expect(editor.getHTML()).toBe(content)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('updates undo and redo availability after real editing transactions', async () => {
    render(<Editor content="<p>Existing article text.</p>" onChange={jest.fn()} />)
    const textbox = await screen.findByRole('textbox', { name: 'Text bearbeiten' })
    const editor = (textbox as HTMLElement & { editor: TiptapEditor }).editor
    const undo = screen.getByRole('button', { name: /^Rückgängig$/ })
    const redo = screen.getByRole('button', { name: /^Wiederholen$/ })
    expect(undo).toBeDisabled()
    expect(redo).toBeDisabled()

    act(() => { editor.commands.insertContent('Added text. ') })
    expect(textbox).toHaveTextContent('Added text. Existing article text.')
    expect(undo).toBeEnabled()
    fireEvent.click(undo)
    expect(textbox).toHaveTextContent('Existing article text.')
    expect(undo).toBeDisabled()
    expect(redo).toBeEnabled()
    fireEvent.click(redo)
    expect(textbox).toHaveTextContent('Added text. Existing article text.')
    expect(undo).toBeEnabled()
    expect(redo).toBeDisabled()
  })
})
