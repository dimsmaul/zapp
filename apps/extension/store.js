const DATABASE = 'zapp-captures'

async function drafts(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('drafts', mode)
      const request = operation(transaction.objectStore('drafts'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? new Error('Draft storage failed.'))
    })
  } finally {
    db.close()
  }
}

export const getDraft = (id) => drafts('readonly', (store) => store.get(id))
export const saveDraft = (draft) => drafts('readwrite', (store) => store.put(draft))
export const removeDraft = (id) => drafts('readwrite', (store) => store.delete(id))
export const draftIds = () => drafts('readonly', (store) => store.getAllKeys())
export const listDrafts = () => drafts('readonly', (store) => store.getAll())
