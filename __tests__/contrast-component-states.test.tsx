import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileEditForm } from '@/components/profile/ProfileEditForm';
import { QuizRenderer } from '@/app/courses/[courseId]/contents/QuizRenderer';
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
  expect(screen.getByLabelText('Name')).toHaveClass('border-destructive');
  expect(screen.getByLabelText('Kontakt')).toHaveClass('border-destructive');
});

it('renders correct quiz results with the measured light and dark color pair', () => {
  render(<QuizRenderer content={{ questions: [{ id: 'fixture-question', type: 'TRUE_FALSE', question: 'Stimmt das?', options: ['Wahr', 'Falsch'], correctAnswers: [0] }] }} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Wahr' }));
  fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Quiz beenden' }));
  expect(screen.getByText('✓ Richtig')).toHaveClass('text-green-700', 'dark:text-green-400');
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
