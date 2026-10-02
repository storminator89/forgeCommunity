import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContentList } from '@/app/courses/[courseId]/contents/ContentList';
import { CourseContentsSidebar } from '@/app/courses/[courseId]/contents/CourseContentsSidebar';
import { NewMainTopicDialog } from '@/app/courses/[courseId]/contents/NewMainTopicDialog';
import { SortableItem } from '@/app/courses/[courseId]/contents/SortableItem';
import { NewSubTopicDialog } from '@/app/courses/[courseId]/contents/NewSubTopicDialog';
import type { CourseContent } from '@/app/courses/[courseId]/contents/types';
import { markPageAsVisited } from '@/app/courses/[courseId]/contents/utils/visitedPages';

const mockDrag = jest.fn();
jest.mock('@dnd-kit/sortable', () => ({ useSortable: () => ({ attributes: { role: 'button', tabIndex: 0 }, listeners: { onPointerDown: mockDrag }, setNodeRef: jest.fn(), setActivatorNodeRef: jest.fn(), transform: null, transition: undefined, isDragging: false }) }));

const content = (id: string, order = 0, subContents?: CourseContent[]): CourseContent => ({ id, title: id, courseId: 'course', type: 'TEXT', content: '', order, parentId: null, subContents });
const baseProps = () => ({
  selectedContentId: null, onContentSelect: jest.fn(), onEditClick: jest.fn(), onDeleteClick: jest.fn(),
  isInlineEditing: null, inlineEditTitle: '', onInlineEditSubmit: jest.fn(), setIsInlineEditing: jest.fn(), setInlineEditTitle: jest.fn(),
  onMoveUp: jest.fn(), onMoveDown: jest.fn(), mainContentId: 'parent', mainTopicIndex: 0, courseId: 'course', onVisitedToggle: jest.fn(),
});
beforeEach(() => { jest.clearAllMocks(); window.localStorage.clear(); });

it('orders siblings by order and passes the actual nested parent plus child to keyboard reorder callbacks', async () => {
  const props = baseProps();
  render(<ContentList {...props} contents={[content('second', 4), content('first', 1, [content('grandchild-a', 0), content('grandchild-b', 1)])]} />);
  const titles = screen.getAllByRole('button').filter(button => ['first', 'second'].includes(button.textContent ?? ''));
  expect(titles.map(button => button.textContent)).toEqual(['first', 'second']);
  expect(screen.getByRole('button', { name: 'first nach oben verschieben' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'grandchild-b nach oben verschieben' }));
  await waitFor(() => expect(props.onMoveUp).toHaveBeenCalledWith('first', 'grandchild-b'));
  fireEvent.click(screen.getByRole('button', { name: 'second nach oben verschieben' }));
  await waitFor(() => expect(props.onMoveUp).toHaveBeenCalledWith('parent', 'second'));
});

it('does not save a rename on blur, submits Enter once and lets Escape cancel without saving', async () => {
  const props = baseProps();
  function Tree() {
    const [editing, setEditing] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    return <ContentList {...props} contents={[content('item')]} isInlineEditing={editing} setIsInlineEditing={setEditing} inlineEditTitle={title} setInlineEditTitle={setTitle} />;
  }
  render(<Tree />);
  fireEvent.click(screen.getByRole('button', { name: 'item umbenennen' }));
  const input = screen.getByRole('textbox', { name: 'Titel von item' });
  fireEvent.change(input, { target: { value: ' Neuer Titel ' } });
  fireEvent.blur(input);
  expect(props.onInlineEditSubmit).not.toHaveBeenCalled();
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(props.onInlineEditSubmit).toHaveBeenCalledWith('item', 'Neuer Titel'));
  expect(props.onInlineEditSubmit).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'item umbenennen' }));
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(props.onInlineEditSubmit).toHaveBeenCalledTimes(1);
});

it('retains failed rename and deletion dialogs with inline errors', async () => {
  const props = baseProps();
  props.onInlineEditSubmit.mockRejectedValue(new Error('Titel konnte nicht gespeichert werden'));
  props.onDeleteClick.mockRejectedValue(new Error('Löschen fehlgeschlagen'));
  const { rerender } = render(<ContentList {...props} contents={[content('item')]} isInlineEditing="item" inlineEditTitle="Neu" />);
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Titel konnte nicht gespeichert werden');
  expect(props.setIsInlineEditing).not.toHaveBeenCalled();
  rerender(<ContentList {...props} contents={[content('item')]} />);
  fireEvent.click(screen.getByRole('button', { name: 'item löschen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Löschen fehlgeschlagen');
  expect(screen.getByRole('alertdialog')).toBeVisible();
});

it.each([NewMainTopicDialog, NewSubTopicDialog])('validates title, prevents repeated dialog submits and keeps the draft on failure', async DialogComponent => {
  let rejectSubmit!: (error: Error) => void;
  const submit = jest.fn(() => new Promise<void>((_, reject) => { rejectSubmit = reject; }));
  const onTitleChange = jest.fn();
  const onOpenChange = jest.fn();
  const { rerender } = render(<DialogComponent isOpen onOpenChange={onOpenChange} title="   " onTitleChange={onTitleChange} onSubmit={submit} />);
  expect(screen.getByRole('button', { name: 'Erstellen' })).toBeDisabled();
  rerender(<DialogComponent isOpen onOpenChange={onOpenChange} title=" Kapitel " onTitleChange={onTitleChange} onSubmit={submit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }));
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith('Kapitel');
  expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled();
  await act(async () => rejectSubmit(new Error('Server nicht erreichbar')));
  expect(screen.getByRole('alert')).toHaveTextContent('Server nicht erreichbar');
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(onTitleChange).not.toHaveBeenCalled();
});

it('captures the chosen nested parent for creation and hides management controls for learners', async () => {
  const props = baseProps();
  const onSubContentSubmit = jest.fn();
  const sidebarProps = { ...props, contents: [content('chapter', 0, [content('nested')])], mainContentId: null, courseName: 'Kurs', isLoading: false, onMainContentSubmit: jest.fn(), onSubContentSubmit, onMainContentSelect: jest.fn() };
  const { rerender } = render(<CourseContentsSidebar {...sidebarProps} />);
  fireEvent.click(screen.getByRole('button', { name: 'Unterthema zu nested hinzufügen' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Titel' }), { target: { value: ' Kind ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }));
  await waitFor(() => expect(onSubContentSubmit).toHaveBeenCalledWith('Kind', 'nested'));
  rerender(<CourseContentsSidebar {...sidebarProps} canManage={false} />);
  expect(screen.queryByRole('button', { name: /umbenennen|löschen|Neues Kapitel|Unterthema zu/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'nested' }));
  expect(props.onContentSelect).toHaveBeenCalledWith('nested');
});

it('requires standalone leaves and deeply nested leaves before enabling certificates', () => {
  markPageAsVisited('course', 'deep');
  const props = { ...baseProps(), contents: [content('chapter', 0, [content('nested', 0, [content('deep')])]), content('standalone', 1)], mainContentId: null, courseName: 'Kurs', isLoading: false, onSubContentSubmit: jest.fn(), canManage: false };
  const { rerender } = render(<CourseContentsSidebar {...props} />);
  expect(screen.getByRole('button', { name: 'Zertifikat herunterladen' })).toBeDisabled();
  act(() => markPageAsVisited('course', 'standalone'));
  rerender(<CourseContentsSidebar {...props} />);
  expect(screen.getByRole('button', { name: 'Zertifikat herunterladen' })).toBeEnabled();
});

it('routes chapter and nested reorder separately through the sidebar', async () => {
  const props = baseProps();
  const onMoveMainUp = jest.fn();
  render(<CourseContentsSidebar {...props} contents={[content('first', 0, [content('child-a', 0), content('child-b', 1)]), content('second', 1)]} mainContentId={null} courseName="Kurs" isLoading={false} onSubContentSubmit={jest.fn()} onMoveMainUp={onMoveMainUp} onMoveMainDown={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'second nach oben verschieben' }));
  await waitFor(() => expect(onMoveMainUp).toHaveBeenCalledWith('second'));
  fireEvent.click(screen.getByRole('button', { name: 'child-b nach oben verschieben' }));
  await waitFor(() => expect(props.onMoveUp).toHaveBeenCalledWith('first', 'child-b'));
});

it('attaches drag listeners to the handle so interacting with form inputs cannot start dragging', () => {
  render(<SortableItem id="item" label="Kapitel"><input aria-label="Titel bearbeiten" /></SortableItem>);
  fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Titel bearbeiten' }));
  expect(mockDrag).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Kapitel verschieben' }));
  expect(mockDrag).toHaveBeenCalledTimes(1);
});
