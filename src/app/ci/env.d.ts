// CI: typed Vite env for the Content Intelligence Studio build flags.
interface ImportMetaEnv {
  /** `'1'` when building the hosted Studio service; unset upstream. */
  readonly VITE_CI_STUDIO?: string
}
