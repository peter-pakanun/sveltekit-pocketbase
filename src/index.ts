import PocketBase, { AuthModel } from 'pocketbase'
import {
  json,
  type MaybePromise,
  type RequestEvent,
  type ResolveOptions
} from '@sveltejs/kit'
import { writable, type Writable } from 'svelte/store'
import { BROWSER } from 'esm-env-robust'

interface SvelteKitPocketBaseConfig {
  /**
   * PocketBase URL
   * @default 'http://127.0.0.1:8090'
   */
  pbBaseUrl?: string

  /**
   * Route to use internally for authentication syncing
   * @default '/users/sync'
   */
  syncRoute?: string
}

type HandleHookT = (input: {
  event: RequestEvent
  resolve(event: RequestEvent, opts?: ResolveOptions): MaybePromise<Response>
}) => MaybePromise<Response | false>

type SyncJsonType = {
  hasUpdate?: boolean
  isValid?: boolean
  token?: string
  model?: AuthModel
}

export default class SvelteKitPocketBase {
  /**
   * The PocketBase instance
   * You can use this to access the PocketBase API
   * This library comes with a `user` store that is synced with the `pb.authStore.model`
   *
   * Note:
   * - To logout, set the user store to `null`
   * - To login, you can use the `pb.collection('users').authWithXXX` as usual
   *   and then set the user store to the returned model
   */
  pb: PocketBase
  user: Writable<AuthModel>

  private syncRoute: string
  private logoutRoute = '/users/logout'

  /**
   * Create a new SvelteKitPocketBase instance
   *
   * @param options options for the SvelteKitPocketBase
   */
  constructor(options?: SvelteKitPocketBaseConfig) {
    const defaultOptions = {
      pbBaseUrl: 'http://127.0.0.1:8090',
      syncRoute: '/users/sync'
    }
    const { pbBaseUrl, syncRoute } = { ...defaultOptions, ...options }

    this.pb = new PocketBase(pbBaseUrl)
    this.syncRoute = syncRoute

    // Setup the user store
    if (BROWSER) this.authSync()

    const { subscribe, set, update } = writable(this.pb.authStore.model)
    this.user = {
      subscribe,
      set: async (value: AuthModel): Promise<void> => {
        if (this.pb.authStore.model === value) return
        if (value === null) {
          // this is a logout
          await this.authSync()
        }
        if (value !== null) {
          // this is a login, update the server
          await this.authSync()
        }
        return set(this.pb.authStore.model)
      },
      update
    }
  }

  /**
   * Hook for SvelteKit to handle authentication
   * It take handle's input and return a response or false if the hook is not handled
   *
   * @example
   * Inside `src/hooks.server.js/ts`:
   * ```js
   * import { db } from '$lib/db';
   * export async function handle({ event, resolve }) {
   *   let response = await db.handleHook({ event, resolve });
   *   if (!response) {
   *     response = await resolve(event);
   *   }
   *   return response;
   * }
   * ```
   */
  handleHook: HandleHookT = async ({ event }) => {
    // load the store data from the request cookie string
    this.pb.authStore.loadFromCookie(event.request.headers.get('cookie') || '')

    try {
      // get an up-to-date auth store state by verifying and refreshing the loaded auth model (if any)
      this.pb.authStore.isValid &&
        (await this.pb.collection('users').authRefresh())
    } catch (_) {
      // clear the auth store on failed refresh
      this.pb.authStore.clear()
    }

    if (event.url.pathname.startsWith(this.syncRoute)) {
      return await this.handleSync(event)
    } else if (event.url.pathname.startsWith(this.logoutRoute)) {
      // return await this.handleLogout()
    }

    return false
  }

  private async handleSync({ request }: RequestEvent): Promise<Response> {
    const clientAuthStore = (await request.json()) as SyncJsonType

    if (this.pb.authStore.isValid == clientAuthStore.isValid) {
      console.log('No update needed')
      return json({
        hasUpdate: false
      })
    }

    if (clientAuthStore.isValid) {
      console.log('Client is valid, updating server...')
      this.pb.authStore.save(clientAuthStore.token || '', clientAuthStore.model)
      if (this.pb.authStore.isValid) {
        console.log('Server is now valid')
        const response = json({
          hasUpdate: false
        })
        this.addCookie(response)
        return response
      }
    }

    console.log('Client is not valid afterall, logging out...')
    this.pb.authStore.clear()

    // in case we need to update, we can just update the client's auth store with the latest state
    const response = json({
      hasUpdate: true,
      token: this.pb.authStore.token,
      model: this.pb.authStore.model
    })
    this.addCookie(response)

    return response
  }

  // private async handleLogout(): Promise<Response> {
  //   this.pb.authStore.clear()
  //   const response = json({
  //     hasUpdate: true
  //   })
  //   this.addCookie(response)
  //   return response
  // }

  private addCookie(response: Response): Response {
    response.headers.append('set-cookie', this.pb.authStore.exportToCookie())
    return response
  }

  /**
   * Client code for syncing the auth state with the server
   */
  private async authSync(): Promise<void> {
    console.log('Syncing auth')
    const response = (await fetch(this.syncRoute, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        isValid: this.pb.authStore.isValid,
        token: this.pb.authStore.token,
        model: this.pb.authStore.model
      })
    }).then((res) => res.json())) as SyncJsonType
    if (response.hasUpdate) {
      this.pb.authStore.save(response.token || '', response.model)
    }
  }

  /**
   * Client code for logging out
   */
  // private async authLogout(): Promise<boolean> {
  //   const response = (await fetch(this.logoutRoute, {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json'
  //     }
  //   }).then((res) => res.json())) as SyncJsonType

  //   if (!response.hasUpdate) {
  //     return false
  //   }

  //   this.pb.authStore.clear()
  //   return true
  // }
}
