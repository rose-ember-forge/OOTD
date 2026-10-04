// Bulk import runner. Lives at module level so an import keeps going while she moves
// around the app. Each photo is processed on the device, then uploaded straight away
// as an item with no type yet; those untyped items form the "to tag" review queue.

import { processPhoto } from './image.js';

const MAX_PARALLEL_UPLOADS = 3;
const RECENT_THUMBS = 12;

export const importState = {
  running: false,
  finished: false,
  stopRequested: false,
  total: 0,
  done: 0,
  failed: [], // file names
  recent: [], // object URLs of the latest thumbnails
  status: '',
};

const listeners = new Set();
export function onImportProgress(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn(importState));

export function stopImport() {
  importState.stopRequested = true;
  importState.status = 'Stopping after the current photo…';
  emit();
}

// iPhone stops the page when the screen locks, so ask it to stay awake while importing.
async function keepAwake() {
  if (!('wakeLock' in navigator)) return () => {};
  let lock = null;
  const acquire = async () => {
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch {
      /* not allowed right now; fine */
    }
  };
  const onVisible = () => document.visibilityState === 'visible' && acquire();
  await acquire();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    lock?.release().catch(() => {});
  };
}

const warnOnLeave = (e) => {
  e.preventDefault();
  e.returnValue = '';
};

/**
 * Import `files` as new items. `defaults` = { seasons, occasions, removeBackground }.
 * Resolves when everything is processed and uploaded (or stopped).
 */
export async function startImport(store, files, defaults) {
  if (importState.running) throw new Error('An import is already running');
  importState.recent.forEach((u) => URL.revokeObjectURL(u));
  Object.assign(importState, {
    running: true,
    finished: false,
    stopRequested: false,
    total: files.length,
    done: 0,
    failed: [],
    recent: [],
    status: '',
  });
  emit();

  const release = await keepAwake();
  window.addEventListener('beforeunload', warnOnLeave);
  const uploads = new Set();
  const fields = { seasons: defaults.seasons, occasions: defaults.occasions, tags: [] };

  try {
    for (const file of files) {
      if (importState.stopRequested) break;
      let images;
      try {
        images = await processPhoto(file, {
          removeBackground: defaults.removeBackground,
          onStatus: (t) => {
            importState.status = t;
            emit();
          },
        });
      } catch (err) {
        console.warn('Could not process', file.name, err);
        importState.failed.push(file.name);
        emit();
        continue;
      }

      // Upload in the background while the next photo is processed.
      const upload = store
        .saveItem(
          null,
          { ...fields, color: images.color, use_original: false },
          { photo: images.photo, thumb: images.thumb, original: images.original },
        )
        .then(() => {
          importState.done++;
          importState.recent.unshift(URL.createObjectURL(images.thumb));
          importState.recent.splice(RECENT_THUMBS).forEach((u) => URL.revokeObjectURL(u));
        })
        .catch((err) => {
          console.warn('Could not upload', file.name, err);
          importState.failed.push(file.name);
        })
        .finally(() => {
          uploads.delete(upload);
          emit();
        });
      uploads.add(upload);
      if (uploads.size >= MAX_PARALLEL_UPLOADS) await Promise.race(uploads);
    }
    importState.status = 'Finishing uploads…';
    emit();
    await Promise.all(uploads);
  } finally {
    window.removeEventListener('beforeunload', warnOnLeave);
    release();
    Object.assign(importState, { running: false, finished: true, status: '' });
    emit();
  }
}
