// One-use frame handoff between the detail page and image editor. No library files are written.
const imageEditorTransfer = (() => {
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("grok-chameleon-editor-transfer", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("frames");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("편집기에 프레임을 전달할 임시 저장소를 열지 못했습니다."));
    });
  }
  async function run(action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("frames", "readwrite");
        const request = action(transaction.objectStore("frames"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = transaction.onabort = () => reject(new Error("편집기 프레임 전달에 실패했습니다."));
      });
    } finally {
      db.close();
    }
  }
  return {
    async put(blob) {
      const key = crypto.randomUUID();
      await run(store => store.put(blob, key));
      return key;
    },
    take(key) {
      return run(store => {
        const request = store.get(key);
        request.onsuccess = () => store.delete(key);
        return request;
      });
    },
    remove(key) {
      return run(store => store.delete(key));
    },
  };
})();
