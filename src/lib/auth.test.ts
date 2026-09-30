import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  popup: vi.fn(),
  persistence: vi.fn(),
  providerParameters: vi.fn(),
  auth: {},
}))

vi.mock('./firebase', () => ({ auth: mocks.auth }))
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters = mocks.providerParameters
  },
  signInWithPopup: mocks.popup,
  setPersistence: mocks.persistence,
  browserLocalPersistence: {},
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(),
}))

import { signInToSync, syncSignInErrorMessage } from './auth'

describe('Google sign-in', () => {
  beforeEach(() => {
    mocks.popup.mockReset()
    mocks.persistence.mockReset()
  })

  it('opens the popup synchronously without waiting for a storage operation', async () => {
    const user = { uid: 'owner', email: 'owner@example.com' }
    mocks.popup.mockResolvedValue({ user })
    mocks.persistence.mockImplementation(() => new Promise(() => {}))

    const pending = signInToSync()

    expect(mocks.popup).toHaveBeenCalledOnce()
    expect(mocks.popup.mock.calls[0][0]).toBe(mocks.auth)
    expect(mocks.persistence).not.toHaveBeenCalled()
    await expect(pending).resolves.toBe(user)
  })

  it('propagates blocked-popup failures rather than reporting a signed-in user', async () => {
    const error = Object.assign(new Error('Firebase: Error (auth/popup-blocked).'), {
      code: 'auth/popup-blocked',
    })
    mocks.popup.mockRejectedValue(error)

    await expect(signInToSync()).rejects.toBe(error)
    expect(syncSignInErrorMessage(error)).toContain('Allow pop-ups')
    expect(syncSignInErrorMessage(error)).toContain('Safari or Chrome')
  })

  it.each([
    ['auth/popup-closed-by-user', 'not completed'],
    ['auth/cancelled-popup-request', 'interrupted'],
    ['auth/unauthorized-domain', 'authorized domains'],
    ['auth/operation-not-allowed', 'not enabled'],
    ['auth/web-storage-unsupported', 'browser storage'],
    ['auth/network-request-failed', 'internet connection'],
  ])('explains %s', (code, message) => {
    expect(syncSignInErrorMessage({ code })).toContain(message)
  })

  it('keeps unexpected errors visible', () => {
    expect(syncSignInErrorMessage(new Error('Unexpected failure'))).toBe('Unexpected failure')
  })
})
