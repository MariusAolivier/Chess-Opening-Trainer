const OAUTH_AUTHORIZE_URL = 'https://lichess.org/oauth'
const OAUTH_TOKEN_URL = 'https://lichess.org/api/token'
const ACCOUNT_URL = 'https://lichess.org/api/account'

const TOKEN_KEY = 'chess-opening-trainer:lichess:token'
const PKCE_KEY_PREFIX = 'chess-opening-trainer:lichess:pkce:'
const SYNC_AFTER_LOGIN_KEY = 'chess-opening-trainer:lichess:sync-after-login'

const SCOPE = 'study:read'

interface StoredLichessToken {
  accessToken: string
  expiresAt: number | null
}

interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  scope?: string
}

interface LichessAccount {
  id: string
  username: string
}

function toBase64Url(input: Uint8Array): string {
  const binary = String.fromCharCode(...input)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

async function sha256(input: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return new Uint8Array(digest)
}

function oauthClientId(): string {
  return window.location.origin
}

function redirectUri(): string {
  return window.location.origin + window.location.pathname
}

export function clearLichessToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function loadLichessToken(): string | null {
  const raw = localStorage.getItem(TOKEN_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as StoredLichessToken
    if (!parsed.accessToken) return null
    if (parsed.expiresAt !== null && parsed.expiresAt <= Date.now()) {
      clearLichessToken()
      return null
    }
    return parsed.accessToken
  } catch {
    return null
  }
}

function saveLichessToken(accessToken: string, expiresInSeconds?: number): void {
  const expiresAt = typeof expiresInSeconds === 'number'
    ? Date.now() + expiresInSeconds * 1000
    : null

  const payload: StoredLichessToken = { accessToken, expiresAt }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(payload))
}

export async function beginLichessOAuthLoginAndSync(): Promise<never> {
  const state = randomString(24)
  const codeVerifier = randomString(64)
  const codeChallenge = toBase64Url(await sha256(codeVerifier))

  localStorage.setItem(PKCE_KEY_PREFIX + state, codeVerifier)
  localStorage.setItem(SYNC_AFTER_LOGIN_KEY, 'true')

  const url = new URL(OAUTH_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', oauthClientId())
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  window.location.assign(url.toString())
  throw new Error('Redirecting to Lichess OAuth')
}

export function shouldSyncAfterLogin(): boolean {
  return localStorage.getItem(SYNC_AFTER_LOGIN_KEY) === 'true'
}

function clearSyncAfterLoginFlag(): void {
  localStorage.removeItem(SYNC_AFTER_LOGIN_KEY)
}

function consumeCodeVerifier(state: string): string | null {
  const key = PKCE_KEY_PREFIX + state
  const verifier = localStorage.getItem(key)
  localStorage.removeItem(key)
  return verifier
}

export async function completeLichessOAuthFromUrl(): Promise<{ accessToken: string; shouldSync: boolean } | null> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (!code && !state && !error) {
    return null
  }

  url.searchParams.delete('code')
  url.searchParams.delete('state')
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  window.history.replaceState({}, '', url.toString())

  if (error) {
    clearSyncAfterLoginFlag()
    throw new Error('Lichess login failed or was cancelled')
  }

  if (!code || !state) {
    clearSyncAfterLoginFlag()
    throw new Error('Lichess login response is missing required parameters')
  }

  const codeVerifier = consumeCodeVerifier(state)
  if (!codeVerifier) {
    clearSyncAfterLoginFlag()
    throw new Error('Lichess login session expired; please try again')
  }

  const body = new URLSearchParams()
  body.set('grant_type', 'authorization_code')
  body.set('code', code)
  body.set('redirect_uri', redirectUri())
  body.set('client_id', oauthClientId())
  body.set('code_verifier', codeVerifier)

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    clearSyncAfterLoginFlag()
    throw new Error('Could not finish Lichess login')
  }

  const tokenResponse = await response.json() as OAuthTokenResponse
  if (!tokenResponse.access_token) {
    clearSyncAfterLoginFlag()
    throw new Error('Lichess did not return an access token')
  }

  saveLichessToken(tokenResponse.access_token, tokenResponse.expires_in)
  const shouldSync = shouldSyncAfterLogin()
  clearSyncAfterLoginFlag()

  return { accessToken: tokenResponse.access_token, shouldSync }
}

export async function fetchLichessAccount(accessToken: string): Promise<LichessAccount> {
  const response = await fetch(ACCOUNT_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (response.status === 401) {
    clearLichessToken()
    throw new Error('Lichess session expired, please connect again')
  }

  if (!response.ok) {
    throw new Error('Could not read Lichess account')
  }

  const account = await response.json() as LichessAccount
  if (!account.username) {
    throw new Error('Could not read Lichess username')
  }
  return account
}

export async function exportLichessStudiesPgn(accessToken: string, username: string): Promise<string> {
  const response = await fetch(`https://lichess.org/api/study/by/${encodeURIComponent(username)}/export.pgn`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/x-chess-pgn',
    },
  })

  if (response.status === 401) {
    clearLichessToken()
    throw new Error('Lichess session expired, please connect again')
  }

  if (!response.ok) {
    throw new Error('Could not export studies from Lichess')
  }

  return response.text()
}