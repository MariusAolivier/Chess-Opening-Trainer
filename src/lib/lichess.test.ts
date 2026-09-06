import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLichessGameStats } from './lichess'

describe('Lichess game insights', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps distinct opening names that share an ECO code separate', async () => {
    const games = [
      {
        opening: { eco: 'B20', name: 'Sicilian Defense' },
        winner: 'white',
        players: { white: { user: { name: 'Player' } }, black: { user: { name: 'Opponent' } } },
      },
      {
        opening: { eco: 'B20', name: 'Sicilian Defense: Wing Gambit' },
        winner: 'black',
        players: { white: { user: { name: 'Player' } }, black: { user: { name: 'Opponent' } } },
      },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      games.map(game => JSON.stringify(game)).join('\n'),
      { status: 200 },
    )))

    const stats = await fetchLichessGameStats('Player', null)

    expect(stats.map(stat => stat.opening)).toEqual([
      'Sicilian Defense',
      'Sicilian Defense: Wing Gambit',
    ])
  })
})
