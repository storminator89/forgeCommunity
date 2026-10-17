import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotificationProvider, useNotifications } from '@/contexts/NotificationContext';
import { useSession } from 'next-auth/react';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
const mockSession = jest.mocked(useSession);
const notice = { id: 'promotion', type: 'EVENT', content: 'Ein Platz ist frei geworden.', userId: 'alice',
  isRead: false, createdAt: '2026-10-16T00:00:00Z', targetState: 'available', actionLabel: 'Event ansehen' };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const opened = jest.fn();

function Consumer() {
  const { notifications, openNotification } = useNotifications();
  return <><div data-testid="notices">{notifications.map(item => `${item.content}:${item.isRead}`).join(',')}</div>
    <button onClick={() => void openNotification('promotion').then(opened)}>Event ansehen</button></>;
}
const tree = () => <NotificationProvider><Consumer /></NotificationProvider>;
function setUser(id: string) {
  mockSession.mockReturnValue({ data: { user: { id }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>);
}
function mockDestination(href: unknown, status = 200) {
  jest.mocked(fetch).mockImplementation(async url => String(url).endsWith('/open')
    ? response({ href }, status) : response([notice]));
}

beforeEach(() => {
  jest.clearAllMocks(); jest.mocked(fetch).mockReset(); setUser('alice');
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each(['/events#event-cm_event-123', '/profile/user_1', '/community#comment-reply1', '/chat?channelId=room_1&messageId=msg-2'])
('accepts only the server-resolved internal destination %s', async href => {
  mockDestination(href);
  render(tree());
  await screen.findByText('Ein Platz ist frei geworden.:false');
  fireEvent.click(screen.getByRole('button', { name: 'Event ansehen' }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith(href));
  expect(fetch).toHaveBeenCalledWith('/api/notifications/promotion/open', expect.objectContaining({ method: 'POST' }));
  expect(screen.getByTestId('notices')).toHaveTextContent('Ein Platz ist frei geworden.:true');
});

test.each(['https://evil.example/events#event-1', '//evil.example/events#event-1', 'javascript:alert(1)',
  '/events#event-1?redirect=https://evil.example', '/events#event-', '/events#event-../admin', '/events#event-%2fadmin',
  '/events#event-1\n', '/events#event-1#extra', '/events?next=evil#event-1', '/events#event-1&next=evil', '', null, {}])
('rejects a malicious or malformed event destination without marking it read: %j', async href => {
  mockDestination(href);
  render(tree());
  await screen.findByText('Ein Platz ist frei geworden.:false');
  fireEvent.click(screen.getByRole('button', { name: 'Event ansehen' }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith(null));
  expect(screen.getByTestId('notices')).toHaveTextContent('Ein Platz ist frei geworden.:false');
});

test('a revoked or cancelled promotion target cannot navigate and its private message is hidden', async () => {
  mockDestination(null, 404);
  render(tree());
  await screen.findByText('Ein Platz ist frei geworden.:false');
  fireEvent.click(screen.getByRole('button', { name: 'Event ansehen' }));
  await waitFor(() => expect(opened).toHaveBeenCalledWith(null));
  expect(screen.getByTestId('notices')).toHaveTextContent('Das zugehörige Ziel ist nicht mehr verfügbar.');
  expect(screen.getByTestId('notices')).not.toHaveTextContent('Ein Platz ist frei geworden.');
});

test('an old account pending open never supplies a destination after an account switch', async () => {
  let finish!: (value: Response) => void;
  jest.mocked(fetch).mockImplementation(url => String(url).endsWith('/open') ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve(response([notice])));
  const view = render(tree());
  await screen.findByText('Ein Platz ist frei geworden.:false');
  fireEvent.click(screen.getByRole('button', { name: 'Event ansehen' }));
  const signal = jest.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/open'))?.[1]?.signal;
  setUser('bob');
  jest.mocked(fetch).mockResolvedValue(response([]));
  view.rerender(tree());
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(response({ href: '/events#event-alice-private' })));
  expect(opened).toHaveBeenCalledWith(null);
  expect(screen.getByTestId('notices')).toBeEmptyDOMElement();
});


const missionInvitationHref = '/community/spaces/space_1/missions/mission-2?invitation=invite_3#mission-invitation';
test('opens only the freshly server-resolved private mission invitation and never joins from notification reading', async () => {
  mockDestination(missionInvitationHref); render(tree()); await screen.findByText('Ein Platz ist frei geworden.:false'); fireEvent.click(screen.getByRole('button', { name: 'Event ansehen' })); await waitFor(() => expect(opened).toHaveBeenCalledWith(missionInvitationHref));
  const writes = jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method && init.method !== 'GET'); expect(writes).toHaveLength(1); expect(writes[0][0]).toBe('/api/notifications/promotion/open');
});
test.each([
  'https://evil.example' + missionInvitationHref, '//evil.example' + missionInvitationHref,
  missionInvitationHref.replace('?invitation=', '?other=1&invitation='), missionInvitationHref.replace('#mission-invitation', '&other=1#mission-invitation'), missionInvitationHref.replace('#mission-invitation', '&invitation=other#mission-invitation'),
  missionInvitationHref.replace('#mission-invitation', '#mission-contributions'), missionInvitationHref.replace('#mission-invitation', '#mission-invitation#extra'), missionInvitationHref + '\n', missionInvitationHref + '\r', missionInvitationHref + '\u2028', missionInvitationHref + '\u2029', missionInvitationHref + ' ',
  missionInvitationHref.replace('space_1', '%73pace_1'), missionInvitationHref.replace('mission-2', '../mission-2'), missionInvitationHref.replace('invite_3', '%69nvite_3'), missionInvitationHref.replace('invite_3', ''),
  missionInvitationHref.replace('space_1', 's'.repeat(101)), missionInvitationHref.replace('mission-2', 'm'.repeat(101)), missionInvitationHref.replace('invite_3', 'i'.repeat(101)),
  '/community/spaces/space/missions/mission#mission-invitation', '/community/spaces/space/missions/mission?invitation=invite',
])('rejects malformed private mission invitation destinations without broadening navigation: %s', async href => {
  mockDestination(href); render(tree()); await screen.findByText('Ein Platz ist frei geworden.:false'); fireEvent.click(screen.getByRole('button', { name: 'Event ansehen' })); await waitFor(() => expect(opened).toHaveBeenCalledWith(null)); expect(screen.getByTestId('notices')).toHaveTextContent('Ein Platz ist frei geworden.:false');
});
test('rejects a late invitation-open response across account A→B→A without supplying old private navigation', async () => {
  let finish!: (value: Response) => void; jest.mocked(fetch).mockImplementation(url => String(url).endsWith('/open') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response([notice])));
  const view = render(tree()); await screen.findByText('Ein Platz ist frei geworden.:false'); fireEvent.click(screen.getByRole('button', { name: 'Event ansehen' })); setUser('bob'); jest.mocked(fetch).mockResolvedValue(response([])); view.rerender(tree()); setUser('alice'); view.rerender(tree()); await act(async () => finish(response({ href: missionInvitationHref }))); expect(opened).toHaveBeenCalledWith(null); expect(screen.getByTestId('notices')).toBeEmptyDOMElement();
});
