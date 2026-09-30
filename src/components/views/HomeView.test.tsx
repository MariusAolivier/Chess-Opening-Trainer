import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import HomeView from './HomeView'

vi.mock('../Chessboard', () => ({ default: () => null }))

function render(overrides: Partial<ComponentProps<typeof HomeView>> = {}) {
  const props: ComponentProps<typeof HomeView> = {
    syncStatus: 'idle',
    syncError: null,
    totalDue: 2,
    estimatedMinutes: 1,
    storedStudies: [{ id: 'study', name: 'My study', playerColor: 'white', chapters: [] }],
    homeFen: '',
    soundEnabled: false,
    lichessSyncing: false,
    syncUser: null,
    syncAuthLoading: false,
    syncSigningIn: false,
    onTrainNow: vi.fn(),
    onOpenRepertoire: vi.fn(),
    onSyncWithLichess: vi.fn(),
    onSignInToSync: vi.fn(),
    ...overrides,
  }
  return renderToStaticMarkup(<HomeView {...props} />)
}

describe('home cloud account feedback', () => {
  it('does not hide the sign-in control while opening Google for existing progress', () => {
    const html = render({ syncSigningIn: true })

    expect(html).toContain('Opening Google sign-in...')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Keep your progress safe.')
  })

  it('shows account loading instead of hiding the cloud prompt', () => {
    expect(render({ syncAuthLoading: true })).toContain('Checking account...')
  })

  it('also shows the popup state during first-run onboarding', () => {
    expect(render({ storedStudies: [], syncSigningIn: true })).toContain('Opening Google sign-in...')
  })

  it('identifies the authenticated account separately from sync success', () => {
    const html = render({
      syncUser: { email: 'owner@example.com', displayName: 'Owner' },
      syncStatus: 'syncing',
    })

    expect(html).toContain('Signed in as owner@example.com')
    expect(html).toContain('Syncing progress...')
    expect(html).not.toContain('Progress synced')
  })

  it('shows sign-in errors and restores the sign-in control after a failure', () => {
    const html = render({ syncStatus: 'error', syncError: 'Allow pop-ups for this site.' })

    expect(html).toContain('role="alert"')
    expect(html).toContain('Allow pop-ups for this site.')
    expect(html).toContain('Sign in with Google')
    expect(html).not.toContain('disabled=""')
  })
})
