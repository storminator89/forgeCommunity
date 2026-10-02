import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditContentForm } from '@/app/courses/[courseId]/contents/EditContentForm';
import { ContentTypeSelector } from '@/app/courses/[courseId]/contents/ContentTypeSelector';
import { CourseContent, QuizContent } from '@/app/courses/[courseId]/contents/types';
import { getH5PEmbedUrl, getContentValidationError, quizEditorDraft, getCourseVideoUrl, getCourseAudioEmbedUrl } from '@/app/courses/[courseId]/contents/content-form-utils';

beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });

jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange, readOnly }: { content: string; onChange: (value: string) => void; readOnly?: boolean }) => <textarea aria-label="Rich-Text-Inhalt" value={content} disabled={readOnly} onChange={event => onChange(event.target.value)} /> }));
jest.mock('@/app/courses/[courseId]/contents/QuizEditor', () => ({ QuizEditor: ({ onChange }: { onChange: (value: QuizContent) => void }) => <div><button type="button" onClick={() => onChange({ passingScore: 70, questions: [{ id: 'q1', type: 'TEXT_INPUT', question: 'Neue Frage', correctAnswer: 'Antwort' }] })}>Quiz ändern</button><button type="button" onClick={() => onChange({ passingScore: NaN, questions: [{ id: 'q1', type: 'TEXT_INPUT', question: 'Neue Frage', correctAnswer: 'Antwort' }] })}>Bestehensgrenze leeren</button></div> }));

const initial: CourseContent = { id: 'lesson1', courseId: 'course1', parentId: 'topic1', title: 'Einführung', type: 'TEXT', content: '<p>Original</p>', order: 0 };

it('type choices inside a form never submit it and expose the selected type', () => {
  const onSubmit = jest.fn(event => event.preventDefault());
  const onSelectType = jest.fn();
  render(<form onSubmit={onSubmit}><ContentTypeSelector selectedType="TEXT" onSelectType={onSelectType} /></form>);
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onSelectType).toHaveBeenCalledWith('VIDEO');
  expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true');
});

it('restores drafts when switching types and emits only changed fields', () => {
  const onContentChange = jest.fn();
  render(<EditContentForm content={initial} onContentChange={onContentChange} onSubmit={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Neuer Titel' } });
  expect(onContentChange).toHaveBeenLastCalledWith({ title: 'Neuer Titel' });
  fireEvent.change(screen.getByLabelText('Rich-Text-Inhalt'), { target: { value: '<p>Entwurf</p>' } });
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  fireEvent.change(screen.getByLabelText('Video-URL'), { target: { value: 'https://youtu.be/test123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Text' }));
  expect(screen.getByLabelText('Rich-Text-Inhalt')).toHaveValue('<p>Entwurf</p>');
  expect(screen.getByLabelText('Titel')).toHaveValue('Neuer Titel');
  fireEvent.click(screen.getByRole('button', { name: 'Video' }));
  expect(screen.getByLabelText('Video-URL')).toHaveValue('https://youtu.be/test123');
});

it('prevents repeat saves, keeps failure drafts, and permits retry', async () => {
  let rejectSave!: (failure: Error) => void;
  const onSubmit = jest.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; })).mockResolvedValue(undefined);
  render(<EditContentForm content={initial} onContentChange={jest.fn()} onSubmit={onSubmit} onCancel={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: '  Bleibt erhalten  ' } });
  const submit = screen.getByRole('button', { name: 'Speichern' });
  fireEvent.click(submit);
  fireEvent.submit(submit.closest('form')!);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Wird gespeichert…' })).toBeDisabled();
  rejectSave(new Error('Keine Berechtigung'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Keine Berechtigung'));
  expect(screen.getByLabelText('Titel')).toHaveValue('  Bleibt erhalten  ');
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  expect(onSubmit.mock.calls[1][0]).toMatchObject({ title: 'Bleibt erhalten', content: '<p>Original</p>' });
});

it('does not crash or overwrite malformed quizzes and blocks their save', async () => {
  const onSubmit = jest.fn();
  render(<EditContentForm content={{ ...initial, type: 'QUIZ', content: '{broken' }} onContentChange={jest.fn()} onSubmit={onSubmit} onCancel={jest.fn()} />);
  expect(screen.getByLabelText('Quiz-Daten (JSON)')).toHaveValue('{broken');
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('ungültig'))).toBe(true));
  expect(onSubmit).not.toHaveBeenCalled();
});

it('outer save persists the current quiz without a separate inner save', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(<EditContentForm content={{ ...initial, type: 'QUIZ', content: JSON.stringify({ questions: [], passingScore: 70 }) }} onContentChange={jest.fn()} onSubmit={onSubmit} onCancel={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Quiz ändern' }));
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(JSON.parse(onSubmit.mock.calls[0][0].content).questions[0].question).toBe('Neue Frage');
});

it('keeps an empty passing score editable instead of unmounting the quiz editor', () => {
  render(<EditContentForm content={{ ...initial, type: 'QUIZ', content: JSON.stringify({ questions: [], passingScore: 70 }) }} onContentChange={jest.fn()} onSubmit={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Bestehensgrenze leeren' }));
  expect(screen.getByRole('button', { name: 'Quiz ändern' })).toBeInTheDocument();
  expect(quizEditorDraft({ questions: [], passingScore: NaN })).not.toBeNull();
  expect(getContentValidationError('QUIZ', { questions: [], passingScore: NaN })).toBeTruthy();
});

it('supports safe H5P IDs, URLs and legacy iframe snippets while rejecting executable URLs', () => {
  expect(getH5PEmbedUrl('content_123')).toBe('/h5p/embed/content_123');
  expect(getH5PEmbedUrl('https://h5p.example.org/embed/1')).toBe('https://h5p.example.org/embed/1');
  expect(getH5PEmbedUrl('<iframe src="https://h5p.example.org/embed/1" allowfullscreen></iframe>')).toBe('https://h5p.example.org/embed/1');
  expect(getH5PEmbedUrl('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
  expect(getH5PEmbedUrl('//evil.example/embed')).toBeNull();
  expect(getH5PEmbedUrl('/api/admin/users')).toBeNull();
  expect(getH5PEmbedUrl('/h5p/embed/content_123?unused=1')).toBe('/h5p/embed/content_123');
  expect(getH5PEmbedUrl('<iframe src="https://h5p.example.org/embed/1?a=1&amp;b=2"></iframe>')).toBe('https://h5p.example.org/embed/1?a=1&b=2');
  expect(getH5PEmbedUrl('<iframe src="&#106;avascript:alert(1)"></iframe>')).toBeNull();
});

it('turns supported provider pages into playable embeds without broadening allowed sources', () => {
  expect(getCourseVideoUrl('https://vimeo.com/12345')).toBe('https://player.vimeo.com/video/12345');
  expect(getCourseVideoUrl('https://www.dailymotion.com/video/x12345_title')).toBe('https://www.dailymotion.com/embed/video/x12345');
  expect(getCourseVideoUrl('/uploads/lesson.mp4')).toBe('/uploads/lesson.mp4');
  expect(getCourseAudioEmbedUrl('https://open.spotify.com/track/abc123')).toBe('https://open.spotify.com/embed/track/abc123');
  expect(getCourseAudioEmbedUrl('https://soundcloud.com/artist/song')).toBe('https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Fsong');
  expect(getCourseAudioEmbedUrl('/uploads/audio.mp3')).toBeNull();
});
