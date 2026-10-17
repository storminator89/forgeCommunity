import { render, screen } from '@testing-library/react'
import { ReaderContinuePanel } from '@/app/courses/[courseId]/contents/ReaderContinuePanel'
import type { projectReaderProgress } from '@/app/courses/[courseId]/contents/reader-progress'

const ready: ReturnType<typeof projectReaderProgress> = {
  state: 'ready', completedCount: 0, leaves: [], firstLocked: null,
  next: { id: 'next', title: 'Eine lange nächste Lektion', type: 'TEXT', locked: false, completed: false },
}
const flexibleTarget = ['h-auto', 'min-h-11', 'min-w-0', 'max-w-full', 'whitespace-normal', 'px-[min(1rem,16px)]', 'py-[min(.5rem,8px)]', '[overflow-wrap:anywhere]']

it.each([
  ['entry', true, false, false],
  ['next', false, true, false],
  ['selected-refresh', false, false, false],
  ['loading', true, false, true],
] as const)('keeps %s reader controls touch-sized and text-reflowable', (_state, entry, selectedComplete, busy) => {
  render(<ReaderContinuePanel projection={ready} entry={entry} selectedComplete={selectedComplete} busy={busy} onOpen={jest.fn()} onRefresh={jest.fn()} />)
  const refresh = screen.getByRole('button', { name: busy ? 'Wird geprüft …' : 'Lernfortschritt aktualisieren' })
  expect(refresh).toHaveClass(...flexibleTarget)
  expect(refresh).not.toHaveClass('h-11', 'whitespace-nowrap')
  expect(refresh).toHaveTextContent(busy ? 'Wird geprüft …' : 'Aktualisieren')
  if (entry || selectedComplete) {
    const open = screen.getByRole('button', { name: entry ? 'Kurs starten' : 'Nächste Lektion öffnen' })
    expect(open).toHaveClass(...flexibleTarget)
    expect(refresh.parentElement).toHaveClass('min-w-0', 'flex-wrap')
    expect(refresh.closest('[aria-label="Nächster Lernschritt"]')).toHaveClass('px-[min(1.25rem,20px)]', 'sm:px-[min(1.5rem,24px)]')
  }
  if (busy) expect(refresh).toBeDisabled()
})
