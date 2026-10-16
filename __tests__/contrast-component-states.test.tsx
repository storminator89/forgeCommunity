import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileEditForm } from '@/components/profile/ProfileEditForm';
import { QuizRenderer } from '@/app/courses/[courseId]/contents/QuizRenderer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toast, ToastClose, ToastProvider, ToastTitle, ToastViewport } from '@/components/ui/toast';

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.releasePointerCapture = jest.fn();
});

it('renders both profile validation errors with the measured theme-aware error colors', async () => {
  render(<ProfileEditForm userId="fixture-user" initialData={{ name: '', title: null, bio: null, contact: 'invalid' }} onUpdate={jest.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Stammdaten bearbeiten' }));
  await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  expect(screen.getByText('Name ist erforderlich')).toHaveClass('text-destructive');
  expect(screen.getByText('Ungültiges Kontaktformat')).toHaveClass('text-destructive');
  expect(screen.getByText('Name ist erforderlich').querySelector('svg')).toBeInTheDocument();
  expect(screen.getByText('Ungültiges Kontaktformat').querySelector('svg')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toHaveClass('border-destructive');
  expect(screen.getByLabelText('Kontakt')).toHaveClass('border-destructive');
});

it('renders correct quiz results with the semantic success role and a non-color check/text cue', () => {
  render(<QuizRenderer content={{ questions: [{ id: 'fixture-question', type: 'TRUE_FALSE', question: 'Stimmt das?', options: ['Wahr', 'Falsch'], correctAnswers: [0] }] }} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Wahr' }));
  fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Quiz beenden' }));
  expect(screen.getByText('✓ Richtig')).toHaveClass('text-success');
  expect(screen.getByText(/Bestanden!/)).toBeInTheDocument();
});

it('renders incorrect quiz results with error wording, a cross cue, and the separate destructive role', () => {
  render(<QuizRenderer content={{ questions: [{ id: 'fixture-question', type: 'TRUE_FALSE', question: 'Stimmt das?', options: ['Wahr', 'Falsch'], correctAnswers: [0] }] }} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Falsch' }));
  fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
  expect(screen.getByRole('alert')).toHaveTextContent('✗ Falsch');
  fireEvent.click(screen.getByRole('button', { name: 'Quiz beenden' }));
  expect(screen.getByText('✗ Falsch', { exact: false, selector: 'p' })).toHaveClass('text-destructive');
  expect(screen.getByText(/Nicht bestanden/)).toBeInTheDocument();
  expect(screen.getByText(/Richtige Antwort: Wahr/)).toBeInTheDocument();
});

it('keeps the quiz action natively disabled with a visible label until an answer exists', async () => {
  render(<QuizRenderer content={{ questions: [{ id: 'fixture-question', type: 'TRUE_FALSE', question: 'Stimmt das?', options: ['Wahr', 'Falsch'], correctAnswers: [0] }] }} />);
  const check = screen.getByRole('button', { name: 'Antwort prüfen' });
  expect(check).toBeDisabled();
  expect(check).toBeVisible();
  await userEvent.click(check);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Wahr' }));
  expect(check).toBeEnabled();
});

it('preserves disabled input labeling and shared button icon/name without relying on color', async () => {
  const action = jest.fn();
  render(<><Label htmlFor="palette-disabled-input">Gesperrtes Feld</Label><Input id="palette-disabled-input" disabled value="Gespeicherter Wert" readOnly /><Button disabled onClick={action}><svg aria-hidden="true" /><span>Wird gespeichert</span></Button></>);
  expect(screen.getByRole('textbox', { name: 'Gesperrtes Feld' })).toBeDisabled();
  expect(screen.getByLabelText('Gesperrtes Feld')).toHaveValue('Gespeicherter Wert');
  const button = screen.getByRole('button', { name: 'Wird gespeichert' });
  expect(button).toBeDisabled();
  expect(button.querySelector('svg')).toBeInTheDocument();
  expect(button).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-100', 'disabled:bg-muted', 'disabled:text-muted-foreground', 'disabled:border-input');
  expect(button).not.toHaveClass('disabled:opacity-50');
  await userEvent.click(button);
  expect(action).not.toHaveBeenCalled();
});

it('keeps named loading controls and icons opaque and preserves the external focus-ring offset', () => {
  render(<Button data-state="loading" aria-busy="true"><svg aria-hidden="true" /><span>Wird gespeichert</span></Button>);
  const button = screen.getByRole('button', { name: 'Wird gespeichert' });
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button.querySelector('svg')).toBeInTheDocument();
  expect(button).toHaveClass('data-[state=loading]:opacity-100', 'focus-visible:ring-2', 'focus-visible:ring-ring', 'focus-visible:ring-offset-2', 'ring-offset-background');
  expect(button).not.toHaveClass('data-[state=loading]:opacity-75');
});

it('exposes selected tabs through aria-selected and content as well as their theme-aware paint', async () => {
  render(<Tabs defaultValue="account"><TabsList aria-label="Fixture settings"><TabsTrigger value="account">Konto</TabsTrigger><TabsTrigger value="privacy">Privatsphäre</TabsTrigger></TabsList><TabsContent value="account">Kontofelder</TabsContent><TabsContent value="privacy">Deine Privatsphäre</TabsContent></Tabs>);
  const account = screen.getByRole('tab', { name: 'Konto' });
  const privacy = screen.getByRole('tab', { name: 'Privatsphäre' });
  expect(account).toHaveAttribute('aria-selected', 'true');
  expect(account).toHaveClass('data-[state=active]:bg-background', 'data-[state=active]:text-foreground');
  await userEvent.click(privacy);
  expect(privacy).toHaveAttribute('aria-selected', 'true');
  expect(account).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Deine Privatsphäre');
});

it('keeps the destructive toast close control persistently visible, named, and operable', async () => {
  const onOpenChange = jest.fn();
  render(<ToastProvider><Toast variant="destructive" open onOpenChange={onOpenChange}><ToastTitle>Fixture error</ToastTitle><ToastClose /></Toast><ToastViewport /></ToastProvider>);
  const close = screen.getByRole('button', { name: 'Benachrichtigung schließen' });
  // The affordance must not depend on hover/focus to become visible on touch.
  expect(close).toHaveClass('opacity-100');
  expect(close).not.toHaveClass('opacity-0', 'group-hover:opacity-100', 'focus:opacity-100');
  expect(close).toHaveClass('group-[.destructive]:text-destructive-foreground', 'group-[.destructive]:focus:ring-destructive-foreground');
  await userEvent.click(close);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
