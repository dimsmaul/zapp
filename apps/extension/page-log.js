(() => {
  if (globalThis.zappPageObservation) return
  globalThis.zappPageObservation = true

  const original = new Map()
  const emit = (data) => window.dispatchEvent(new CustomEvent('zapp:page-observation', { detail: JSON.stringify(data) }))
  for (const level of ['debug', 'log', 'info', 'warn', 'error']) {
    const method = console[level]
    if (typeof method !== 'function') continue
    const wrapped = function (...args) {
      const result = Reflect.apply(method, this, args)
      try {
        const message = args.slice(0, 8).map((arg) => {
          if (typeof arg === 'string') return arg.slice(0, 200)
          if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg)
          return '[value]'
        }).join(' ')
        emit({ kind: 'console', level, message })
      } catch {
        // Observation failures should never change how the page logs.
      }
      return result
    }
    if (Reflect.set(console, level, wrapped)) original.set(level, { method, wrapped })
  }

  const resources = new PerformanceObserver((entries) => {
    for (const entry of entries.getEntries().slice(0, 50)) {
      emit({ kind: 'resource', url: entry.name.slice(0, 3000), duration: entry.duration, resourceType: entry.initiatorType })
    }
  })
  resources.observe({ entryTypes: ['resource'] })
  window.addEventListener('zapp:stop-observing', () => {
    resources.disconnect()
    for (const [level, { method, wrapped }] of original) {
      if (console[level] === wrapped) console[level] = method
    }
    delete globalThis.zappPageObservation
  }, { once: true })
})()
