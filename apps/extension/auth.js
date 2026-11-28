import { api } from './api.js'

// The Zapp website sends the browser here after you sign in, with a fresh session in the URL fragment.
// The fragment never leaves the browser. We only accept it for the sign-in this extension started.
const message = document.getElementById('message')

function say(text) {
  message.textContent = text
}

try {
  const params = new URLSearchParams(location.hash.slice(1))
  history.replaceState(null, '', location.pathname) // do not leave the token in the address bar or history
  const { login } = await chrome.storage.session.get('login')
  if (!login || login.expiresAt < Date.now() || !params.get('state') || params.get('state') !== login.state) {
    throw new Error('This sign-in link is not valid or has expired. Open Zapp and try again.')
  }
  const account = {
    origin: login.origin, token: params.get('token'), expiresAt: params.get('expiresAt'), userId: params.get('userId'),
    workspaceId: null,
  }
  if (!account.token || !account.userId || !Number.isFinite(Date.parse(account.expiresAt))) {
    throw new Error('The sign-in response was incomplete. Open Zapp and try again.')
  }
  // Make sure the server really issued this session before we keep it.
  const session = await api(account, '/api/v1/session')
  if (session.user?.id !== account.userId) throw new Error('The sign-in response did not match your account.')
  // The server starts the session in the user's default workspace, so there is nothing to pick.
  account.workspaceId = session.workspaceId ?? null
  await chrome.storage.local.set({ account })
  await chrome.storage.session.remove('login')
  say('Connected. You can close this tab.')
  const tab = await chrome.tabs.getCurrent()
  setTimeout(() => { if (tab?.id) void chrome.tabs.remove(tab.id) }, 800)
} catch (error) {
  say(error.message)
}
