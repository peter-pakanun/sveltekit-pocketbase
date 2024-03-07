import PocketBase, { AuthModel } from 'pocketbase'
import {
  json,
  type MaybePromise,
  type RequestEvent,
  type ResolveOptions
} from '@sveltejs/kit'
import { writable, type Writable, type Readable } from 'svelte/store'
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
   * The PocketBase instance.
   * You can use this to access the PocketBase API.
   *
   * @see {@link https://github.com/pocketbase/js-sdk | PocketBase JS SDK}
   */
  pb: PocketBase

  /**
   * The user store.
   * This store is synced with the `pb.authStore.model`
   */
  user: Readable<AuthModel>

  private userStore: Writable<AuthModel>
  private syncRoute: string

  /**
   * Create a new SvelteKitPocketBase instance.
   *
   * @param options options for the SvelteKitPocketBase
   */
  constructor(options?: SvelteKitPocketBaseConfig) {
    const defaultOptions = {
      pbBaseUrl: 'http://127.0.0.1:8090',
      syncRoute: '/users/sync'
    }
    const { pbBaseUrl, syncRoute } = { ...defaultOptions, ...options }

    this.syncRoute = syncRoute

    this.pb = new PocketBase(pbBaseUrl)
    this.pb.authStore.onChange(async (_token, model) => {
      if (BROWSER) {
        await this.authSync()
      }
      this.userStore.set(model)
    })

    this.userStore = writable<AuthModel>(this.pb.authStore.model)
    this.user = {
      subscribe: this.userStore.subscribe
    }
  }

  /**
   * Hook for SvelteKit to handle authentication
   * It take handle's input and return a response or false if the hook is not handled
   *
   * @example
   * ```js
   * // src/hooks.server.js
   * import { hookHandler } from "$lib/db";
   * export async function handle({ event, resolve }) {
   *   let response = await hookHandler({ event, resolve });
   *   if (response !== false) {
   *     return response;
   *   }
   *
   *   response = await resolve(event);
   *
   *   return response;
   * }
   * ```
   */
  hookHandler: HandleHookT = async ({ event }) => {
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
    }

    return false
  }

  private async handleSync({ request }: RequestEvent): Promise<Response> {
    const clientAuthStore = (await request.json()) as SyncJsonType

    if (this.pb.authStore.isValid == clientAuthStore.isValid) {
      // console.log('No update needed')
      return json({
        hasUpdate: false
      })
    }

    if (clientAuthStore.isValid) {
      // console.log('Client is valid, updating server...')
      this.pb.authStore.save(clientAuthStore.token || '', clientAuthStore.model)
      if (this.pb.authStore.isValid) {
        // console.log('Server is now valid')
        const response = json({
          hasUpdate: false
        })
        this.addCookie(response)
        return response
      }
    }

    // console.log('Client is not valid afterall, logging out...')
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

  private addCookie(response: Response): Response {
    response.headers.append('set-cookie', this.pb.authStore.exportToCookie())
    return response
  }

  /**
   * Client code for syncing the auth state with the server
   */
  private async authSync(): Promise<boolean> {
    const result = await fetch(this.syncRoute, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        isValid: this.pb.authStore.isValid,
        token: this.pb.authStore.token,
        model: this.pb.authStore.model
      })
    })

    if (!result.ok) {
      console.error('Auth sync failed:', result.status, result.statusText)
      return false
    }

    return true
  }
}
