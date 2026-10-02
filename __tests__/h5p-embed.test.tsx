import { act, render, screen } from '@testing-library/react';
import { H5PEmbed } from '@/components/h5p/H5PEmbed';

it('isolates imported libraries and accepts resize only from its player', () => {
  render(<H5PEmbed src="/h5p/embed/package1" title="Übung" />);
  const frame = screen.getByTitle('Übung') as HTMLIFrameElement;
  expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  const resize = (source: MessageEventSource | null, height: number) => act(() => window.dispatchEvent(new MessageEvent('message', { source, data: { type: 'forge:h5p:resize', height } })));
  resize(window, 900);
  expect(frame.style.height).toBe('480px');
  resize(frame.contentWindow, 900);
  expect(frame.style.height).toBe('900px');
  resize(frame.contentWindow, Infinity);
  resize(frame.contentWindow, 999999);
  expect(frame.style.height).toBe('900px');
});

it('handles external H5P resize messages and resets height on content changes', () => {
  const { rerender } = render(<H5PEmbed src="https://h5p.example.org/embed/1" title="Übung" />);
  const frame = screen.getByTitle('Übung') as HTMLIFrameElement;
  const post = jest.spyOn(frame.contentWindow!, 'postMessage');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { context: 'h5p', action: 'hello' } })));
  expect(post).toHaveBeenCalledWith({ context: 'h5p', action: 'hello' }, '*');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { context: 'h5p', action: 'prepareResize', clientHeight: 350 } })));
  expect(post).toHaveBeenCalledWith({ context: 'h5p', action: 'resizePrepared' }, '*');
  expect(frame.style.height).toBe('350px');
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { context: 'h5p', action: 'resize', scrollHeight: 720 } })));
  expect(frame.style.height).toBe('720px');
  rerender(<H5PEmbed src="/h5p/embed/package2" title="Andere Übung" />);
  expect(screen.getByTitle('Andere Übung').style.height).toBe('480px');
});
