import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationSearch } from '@/components/navigation-search';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { role: 'USER' } } }) }));

beforeEach(() => push.mockClear());

it.each(['Escape', 'visible close'])('returns keyboard focus to the quick-search opener after %s and can reopen', async dismissal => {
  const user = userEvent.setup();
  render(<NavigationSearch />);
  const opener = screen.getByRole('button', { name: 'Schnellsuche öffnen' });
  await user.tab();
  expect(opener).toHaveFocus();
  await user.keyboard('{Enter}');
  const input = screen.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' });
  await waitFor(() => expect(input).toHaveFocus());

  if (dismissal === 'Escape') await user.keyboard('{Escape}');
  else {
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Schließen' })).toHaveFocus();
    await user.keyboard('{Enter}');
  }
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());

  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' })).toHaveFocus());
  await user.keyboard('{Escape}');
  await waitFor(() => expect(opener).toHaveFocus());
});

it.each(['Control', 'Meta'])('returns to the previous focus after a %s+K shortcut opened search', async modifier => {
  const user = userEvent.setup();
  render(<><button type="button">Vorheriger Fokus</button><NavigationSearch /></>);
  const previous = screen.getByRole('button', { name: 'Vorheriger Fokus' });
  await user.tab();
  expect(previous).toHaveFocus();
  await user.keyboard(`{${modifier}>}k{/${modifier}}`);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' })).toHaveFocus());
  await user.keyboard('{Escape}');
  await waitFor(() => expect(previous).toHaveFocus());
});

it('restores the original focus when the shortcut toggles search closed', async () => {
  const user = userEvent.setup();
  render(<><button type="button">Vorheriger Fokus</button><NavigationSearch /></>);
  const previous = screen.getByRole('button', { name: 'Vorheriger Fokus' });
  await user.tab();
  await user.keyboard('{Control>}k{/Control}');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' })).toHaveFocus());
  await user.keyboard('{Control>}k{/Control}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(previous).toHaveFocus());
});
