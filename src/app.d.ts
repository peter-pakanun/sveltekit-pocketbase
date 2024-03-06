import { AuthModel } from 'pocketbase'

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
  namespace App {
    interface Locals {
      user: AuthModel
    }
  }
}

export {}
