import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { PointsAnimation } from '@/components/PointsAnimation'

function Feedback() {
  const [visible, setVisible] = useState(true)
  return <PointsAnimation points={10} isVisible={visible} onComplete={() => setVisible(false)} />
}

describe('Punktefeedback ohne Animationscallbacks', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('verschwindet auch ohne Motion-Animation wieder', () => {
    render(<Feedback />)
    expect(screen.getByRole('status')).toHaveTextContent('+10 Punkte')
    act(() => jest.advanceTimersByTime(1500))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('meldet nach dem Verlassen der Seite keinen Abschluss mehr', () => {
    const complete = jest.fn()
    const { unmount } = render(<PointsAnimation points={10} isVisible onComplete={complete} />)
    unmount()
    act(() => jest.advanceTimersByTime(1500))
    expect(complete).not.toHaveBeenCalled()
  })
})
