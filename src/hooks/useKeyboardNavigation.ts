import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

interface UseKeyboardNavigationParams {
  quizMode: boolean
  maxMoveIndex: number
  setMoveIndex: Dispatch<SetStateAction<number>>
}

export function useKeyboardNavigation({ quizMode, maxMoveIndex, setMoveIndex }: UseKeyboardNavigationParams): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (quizMode) return
      const tag = (event.target as HTMLElement).tagName
      if (tag === 'SELECT' || tag === 'INPUT') return

      if (event.key === 'ArrowRight') {
        setMoveIndex(index => Math.min(index + 1, maxMoveIndex))
      } else if (event.key === 'ArrowLeft') {
        setMoveIndex(index => Math.max(index - 1, -1))
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maxMoveIndex, quizMode, setMoveIndex])
}
