// CI: the hosted session's user-facing words (Track E3d-b1 moved them out of session.ts).
//
// Every string the hosted Studio shows about saving, loading, brand media and
// renames lives here; components import it through `./session`.

export const HOSTED_COPY = {
  conflict:
    'Someone saved a newer version. Reload to see it, or keep editing and save as a new version.',
  conflictAction: 'Save as new version',
  savedVersion: 'Version saved.',
  draftRestored: (time: string) => `Restored your unsaved draft from ${time}.`,
  sessionExpired: 'Your session with the Studio expired. Reload the page to continue.',
  loadFailed: (message: string) => `The template could not be opened: ${message}`,
  fontsMissing: (count: number) =>
    count === 1 ? '1 brand font could not be loaded.' : `${count} brand fonts could not be loaded.`,
  noBrandMedia: 'This workspace has no user images or logos in its brand kit yet.',
  migrated: (count: number) =>
    count === 1
      ? '1 layer was renamed to the new content: name. Save a version to keep it.'
      : `${count} layers were renamed to the new content: names. Save a version to keep them.`,
  renameFailed: (message: string) => `The template could not be renamed: ${message}`,
  duplicated: (name: string) => `Saved as “${name}”. Opening it…`,
  duplicateFailed: (message: string) => `Save as new template failed: ${message}`
} as const
