/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BOARD_STORAGE_KEY?: string
  readonly VITE_SEED_ON_FIRST_RUN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
