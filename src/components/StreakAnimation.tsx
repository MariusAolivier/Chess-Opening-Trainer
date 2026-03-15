import { useEffect } from 'react'
import './StreakAnimation.css'

interface StreakAnimationProps {
  streakDays: number
  onDone: () => void
}

export default function StreakAnimation({ streakDays, onDone }: StreakAnimationProps) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 2800)
    return () => window.clearTimeout(id)
  }, [onDone])

  return (
    <div className="sa-overlay" onClick={onDone}>
      <div className="sa-card">
        <div className="sa-flame">🔥</div>
        <div className="sa-count">{streakDays}</div>
        <div className="sa-label">Day Streak!</div>
      </div>
    </div>
  )
}
