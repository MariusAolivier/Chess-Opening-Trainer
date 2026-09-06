import { useState } from 'react'
import type { CachedGameStat } from '../../lib/storage'
import { loadInsights, saveInsights } from '../../lib/storage'
import { loadLichessToken } from '../../lib/lichess'
import { fetchLichessGameStats } from '../../lib/lichess'
import './InsightsView.css'

interface InsightsViewProps {
  lichessUsername: string | null
}

type ColorFilter = 'all' | 'white' | 'black'

function winRate(stat: CachedGameStat): number {
  const total = stat.wins + stat.draws + stat.losses
  return total === 0 ? 0 : Math.round((stat.wins / total) * 100)
}

function formatFetchedAt(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export default function InsightsView({ lichessUsername }: InsightsViewProps) {
  const [stats, setStats] = useState<CachedGameStat[] | null>(() => {
    const cached = loadInsights()
    if (cached && lichessUsername && cached.username.toLowerCase() === lichessUsername.toLowerCase()) {
      return cached.stats
    }
    return null
  })
  const [fetchedAt, setFetchedAt] = useState<string | null>(() => {
    const cached = loadInsights()
    if (cached && lichessUsername && cached.username.toLowerCase() === lichessUsername.toLowerCase()) {
      return cached.fetchedAt
    }
    return null
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [colorFilter, setColorFilter] = useState<ColorFilter>('all')

  async function handleSyncGames() {
    if (!lichessUsername) return
    setLoading(true)
    setError(null)
    try {
      const token = loadLichessToken()
      const fetched = await fetchLichessGameStats(lichessUsername, token)
      const now = new Date().toISOString()
      setStats(fetched)
      setFetchedAt(now)
      saveInsights({ username: lichessUsername, fetchedAt: now, stats: fetched })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch games')
    } finally {
      setLoading(false)
    }
  }

  const visible = stats
    ? colorFilter === 'all' ? stats : stats.filter(s => s.color === colorFilter)
    : null

  return (
    <div className="iv-root">
      <section className="iv-section">
        <div className="iv-section-header">
          <h3 className="iv-section-title">Game Performance</h3>
          {fetchedAt && (
            <span className="iv-last-synced">Last synced {formatFetchedAt(fetchedAt)}</span>
          )}
        </div>

        {!lichessUsername ? (
          <p className="iv-no-account">Connect your Lichess account to sync game history.</p>
        ) : (
          <button
            className={`iv-sync-btn ${loading ? 'iv-sync-btn-loading' : ''}`}
            onClick={handleSyncGames}
            disabled={loading}
          >
            {loading ? 'Syncing…' : 'Sync games from Lichess'}
          </button>
        )}

        {error && <p className="iv-error">{error}</p>}

        {visible !== null && (
          <>
            <div className="iv-filter-row">
              {(['all', 'white', 'black'] as ColorFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setColorFilter(f)}
                  className={`iv-filter-btn ${colorFilter === f ? 'iv-filter-btn-active' : ''}`}
                >
                  {f === 'all' ? 'All' : f === 'white' ? '♔ White' : '♚ Black'}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="iv-empty">No games found for this filter.</p>
            ) : (
              <div className="iv-table-wrap">
                <table className="iv-table">
                  <thead>
                    <tr>
                      <th className="iv-th iv-th-opening">Opening</th>
                      <th className="iv-th iv-th-color"></th>
                      <th className="iv-th iv-th-num">W</th>
                      <th className="iv-th iv-th-num">D</th>
                      <th className="iv-th iv-th-num">L</th>
                      <th className="iv-th iv-th-num">Win%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(stat => {
                      const total = stat.wins + stat.draws + stat.losses
                      const wr = winRate(stat)
                      return (
                        <tr key={`${stat.eco}-${stat.opening}-${stat.color}`} className="iv-tr">
                          <td className="iv-td iv-td-opening">
                            <span className="iv-eco">{stat.eco}</span>
                            <span className="iv-opening-name">{stat.opening}</span>
                          </td>
                          <td className="iv-td iv-td-color">
                            {stat.color === 'white' ? '♔' : '♚'}
                          </td>
                          <td className="iv-td iv-td-num iv-wins">{stat.wins}</td>
                          <td className="iv-td iv-td-num iv-draws">{stat.draws}</td>
                          <td className="iv-td iv-td-num iv-losses">{stat.losses}</td>
                          <td className="iv-td iv-td-num">
                            <span
                              className={`iv-winrate ${wr >= 55 ? 'iv-winrate-good' : wr <= 40 ? 'iv-winrate-bad' : ''}`}
                            >
                              {total === 0 ? '—' : `${wr}%`}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
