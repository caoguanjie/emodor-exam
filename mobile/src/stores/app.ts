import { defineStore } from 'pinia'

export const useAppStore = defineStore('mobile-app', {
  state: () => ({
    previewCount: 0,
  }),
})
