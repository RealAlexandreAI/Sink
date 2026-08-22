// Minimal stand-in for Nuxt's virtual `#imports` module so plain-node unit
// tests can resolve it. Only exports what the tested composables actually use;
// individual tests vi.mock('#imports') when they need to override behavior.
export { defineStore } from 'pinia'
