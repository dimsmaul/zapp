export function serverOrigin(input, { originOnly = false } = {}) {
  let url
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Enter a valid server URL, including https://.')
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('Use HTTPS for your Zapp server. HTTP is available on localhost.')
  }
  if (originOnly && (url.pathname !== '/' || url.search || url.hash)) {
    throw new Error('Enter the server origin without a path.')
  }
  return url.origin
}

export function hostPattern(origin) {
  const url = new URL(origin)
  return `${url.protocol}//${url.hostname}/*`
}

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message ?? `Zapp returned HTTP ${status}.`)
    this.status = status
    this.code = data?.code
  }
}

export async function api(account, path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = new Headers()
  if (account.token) headers.set('Authorization', `Bearer ${account.token}`)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)
  const response = await fetch(new URL(path, account.origin), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', credentials: 'omit',
  })
  if (response.status === 204) return
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, data)
  if (!data) throw new Error('The server returned an invalid Zapp response.')
  return data
}

export async function currentAccount() {
  const { account } = await chrome.storage.local.get('account')
  return account
}

export async function send(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ to: 'background', type, ...data })
  if (!result?.ok) throw new Error(result?.error ?? 'Zapp could not complete this action.')
  return result.value
}
