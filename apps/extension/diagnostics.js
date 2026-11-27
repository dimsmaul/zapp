const PRIVATE = /authorization|cookie|password|passwd|token|secret|api[-_ ]?key|credential|session[-_ ]?id/i
const MAX_EVENTS = 6000
const MAX_EVENT_BYTES = 7 * 1024 * 1024
const encoder = new TextEncoder()

function cleanUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return
    url.username = ''
    url.password = ''
    url.hash = ''
    const query = Array.from(url.searchParams, ([name, value]) => [name, PRIVATE.test(name) ? '[REDACTED]' : value])
    url.search = new URLSearchParams(query).toString()
    return url.href.slice(0, 4096)
  } catch {
    return undefined
  }
}

function cleanText(value) {
  return String(value ?? '').slice(0, 1024)
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[REDACTED]')
    .replace(/https?:\/\/[^\s"']+/gi, (url) => cleanUrl(url) ?? '[URL omitted]')
    .replace(/\b(authorization|cookie|password|passwd|token|secret|api[-_ ]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
}

function cleanJson(value, depth = 0) {
  if (depth > 10) return '[OMITTED]'
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => cleanJson(entry, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, child]) => [
      key.slice(0, 120), PRIVATE.test(key) ? '[REDACTED]' : cleanJson(child, depth + 1),
    ]))
  }
  return typeof value === 'string' ? cleanText(value) : value
}

function cleanHeaders(input) {
  return Object.entries(input ?? {}).slice(0, 100).map(([name, value]) => ({
    name: name.slice(0, 120), value: PRIVATE.test(name) ? '[REDACTED]' : cleanText(value),
  }))
}

function body(text, base64 = false) {
  if (text == null) return { state: 'unavailable' }
  if (text === '') return { state: 'empty' }
  if (text.length > 32_768) return { state: 'truncated' }
  if (base64) return { state: 'omitted', reason: 'binary' }
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object') return { state: 'captured', value: cleanJson(value) }
  } catch {
    // Treat bodies without a structured format as opaque.
  }
  return { state: 'omitted', reason: 'opaque_payload' }
}

export function addEvent(session, category, kind, data, details, offsetMs = session.elapsed()) {
  if (session.pausedAt || session.stopping) return
  const event = { category, kind, offsetMs: Math.max(0, offsetMs), data, details }
  const size = encoder.encode(JSON.stringify(event)).length
  if (session.events.length >= MAX_EVENTS || session.eventBytes + size > MAX_EVENT_BYTES) {
    if (!session.warnings.includes('Diagnostic data reached the capture limit.')) {
      session.warnings.push('Diagnostic data reached the capture limit.')
    }
    return
  }
  session.events.push(event)
  session.eventBytes += size
}

export async function attach(session) {
  const target = { tabId: session.tabId }
  try {
    await chrome.debugger.attach(target, '1.3')
    session.debuggerAttached = true
    await Promise.all([
      chrome.debugger.sendCommand(target, 'Network.enable', {
        maxTotalBufferSize: 4 * 1024 * 1024, maxResourceBufferSize: 65_536, maxPostDataSize: 32_768,
      }),
      chrome.debugger.sendCommand(target, 'Runtime.enable'),
      chrome.debugger.sendCommand(target, 'Log.enable'),
    ])
  } catch {
    await detach(session)
    fallback(session)
  }
}

export async function detach(session) {
  if (!session.debuggerAttached) return
  session.debuggerAttached = false
  await chrome.debugger.detach({ tabId: session.tabId }).catch(() => {})
}

export function fallback(session) {
  session.debuggerAttached = false
  session.requests.clear()
  const warning = 'Chrome debugger was unavailable for part of the recording. Page console and resource timing may still be captured.'
  if (!session.warnings.includes(warning)) session.warnings.push(warning)
}

export function pageEvent(session, data) {
  if (data.kind === 'console' && !session.debuggerAttached) {
    addEvent(session, 'console', 'console.log', { level: cleanText(data.level), message: cleanText(data.message) })
  }
  if (data.kind === 'resource' && !session.debuggerAttached) {
    const url = cleanUrl(data.url)
    if (url) addEvent(session, 'network', 'network.observation', {
      url, transport: 'http', durationMs: Math.max(0, Number(data.duration) || 0),
      resourceType: cleanText(data.resourceType),
    })
  }
  if (data.kind === 'click') {
    addEvent(session, 'action', 'action.click', { targetLabel: cleanText(data.tag) })
  }
}

export async function debuggerEvent(session, method, params) {
  if (!session.debuggerAttached || session.stopping) return
  const id = params.requestId
  if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown' || method === 'Log.entryAdded') {
    const message = params.args?.map((arg) => cleanText(arg.value ?? arg.description)).join(' ')
      ?? params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? params.entry?.text
    addEvent(session, 'console', 'console.log', { level: params.type ?? params.entry?.level ?? 'error', message: cleanText(message) })
    return
  }
  if (method === 'Network.requestWillBeSent') {
    const previous = session.requests.get(id)
    const url = cleanUrl(params.request.url)
    if (previous && params.redirectResponse) {
      previous.data.status = params.redirectResponse.status
      previous.details.response = { status: params.redirectResponse.status, headers: cleanHeaders(params.redirectResponse.headers) }
      addEvent(session, 'network', 'http.request', previous.data, previous.details, previous.offset)
    }
    session.requests.delete(id)
    if (!url || session.pausedAt || session.requests.size >= 256) return
    const requestBody = body(params.request.postData)
    const operation = requestBody.value
    session.requests.set(id, {
      offset: session.elapsed(), timestamp: params.timestamp,
      data: {
        method: params.request.method, url, transport: 'http', resourceType: params.type,
        applicationProtocol: operation?.query || operation?.operationName ? 'graphql' : undefined,
        operationName: operation?.operationName,
      },
      details: { request: { method: params.request.method, url, headers: cleanHeaders(params.request.headers), body: requestBody } },
    })
    return
  }
  if (method.startsWith('Network.webSocket')) {
    socketEvent(session, method, params)
    return
  }
  if (method === 'Network.eventSourceMessageReceived') {
    addEvent(session, 'network', 'sse.message', { transport: 'http', applicationProtocol: 'sse', streamId: id, eventName: cleanText(params.eventName) },
      { message: body(params.data), messageId: cleanText(params.eventId) })
    return
  }
  if (method.startsWith('Network.webTransport')) {
    addEvent(session, 'network', 'network.observation', {
      transport: 'webtransport', connectionId: params.transportId, url: cleanUrl(params.url),
    }, { phase: method.split('.').at(-1) })
    return
  }
  const request = session.requests.get(id)
  if (!request) return
  if (method === 'Network.responseReceived') {
    request.data.status = params.response.status
    request.details.response = {
      status: params.response.status, statusText: cleanText(params.response.statusText),
      headers: cleanHeaders(params.response.headers), contentType: cleanText(params.response.mimeType),
      body: { state: 'unavailable' },
    }
  }
  if (!['Network.loadingFinished', 'Network.loadingFailed'].includes(method)) return
  session.requests.delete(id)
  request.data.durationMs = Math.max(0, Math.round((params.timestamp - request.timestamp) * 1000))
  request.details.timing = { durationMs: request.data.durationMs }
  if (method === 'Network.loadingFailed') {
    request.data.failed = true
    request.details.failure = cleanText(params.errorText)
  } else if (request.details.response) {
    if (params.encodedDataLength > 65_536) {
      request.details.response.body = { state: 'truncated' }
    } else if (session.bodyReads < 12) {
      session.bodyReads += 1
      try {
        const response = await chrome.debugger.sendCommand({ tabId: session.tabId }, 'Network.getResponseBody', { requestId: id }).catch(() => null)
        if (response) request.details.response.body = body(response.body, response.base64Encoded)
      } finally {
        session.bodyReads -= 1
      }
    }
  }
  addEvent(session, 'network', 'http.request', request.data, request.details, request.offset)
}

export function flushRequests(session) {
  for (const { data, details, offset } of session.requests.values()) {
    addEvent(session, 'network', 'http.request', data, { ...details, state: 'incomplete' }, offset)
  }
  session.requests.clear()
}

function socketEvent(session, method, params) {
  const common = { transport: 'websocket', connectionId: params.requestId }
  if (method === 'Network.webSocketCreated') {
    addEvent(session, 'network', 'ws.open', { ...common, url: cleanUrl(params.url) })
  } else if (method === 'Network.webSocketClosed') {
    addEvent(session, 'network', 'ws.close', common)
  } else if (method === 'Network.webSocketHandshakeResponseReceived') {
    addEvent(session, 'network', 'ws.handshake', { ...common, status: params.response.status }, {
      request: { headers: cleanHeaders(params.response.requestHeaders) },
      response: { status: params.response.status, headers: cleanHeaders(params.response.headers) },
    })
  } else if (method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') {
    const frame = params.response
    addEvent(session, 'network', 'ws.message', {
      ...common, direction: method.endsWith('Sent') ? 'sent' : 'received', opcode: frame.opcode, size: frame.payloadData.length,
    }, { message: body(frame.payloadData, frame.opcode !== 1) })
  }
}
