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
   * Route used internally for authentication syncing
   * @default '/users/sync'
   */
  syncRoute?: string
}

type HookHandlerT = (input: {
  event: RequestEvent
  resolve(event: RequestEvent, opts?: ResolveOptions): MaybePromise<Response>
}) => MaybePromise<Response | false>

type HookFetchHandlerT = (input: {
  event: RequestEvent
  request: Request
  fetch: typeof fetch
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
  user: Writable<AuthModel>

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

    if (BROWSER) {
      // Auto update the user store in the browser
      this.pb.authStore.onChange(async (_token, model) => {
        await this.authSync()
        this.user.set(model)
      })
    }

    if (!BROWSER) {
      // Disable auto cancellation on the server
      this.pb.autoCancellation(false)
    }

    this.user = writable<AuthModel>(this.pb.authStore.model)
  }

  /**
   * Get the PocketBase instance.
   * This is to avoid Cloudflare Workers' limitations on shared I/O.
   */
  getPB(): PocketBase {
    if (BROWSER) {
      return this.pb
    }
    const _pb = new PocketBase(this.pb.baseUrl)
    return _pb
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
  hookHandler: HookHandlerT = async ({ event }) => {
    event.locals.pb = new PocketBase(this.pb.baseUrl)

    // load the store data from the request cookie string
    event.locals.pb.authStore.loadFromCookie(
      event.request.headers.get('cookie') || ''
    )

    try {
      // get an up-to-date auth store state by verifying and refreshing the loaded auth model (if any)
      event.locals.pb.authStore.isValid &&
        (await event.locals.pb.collection('users').authRefresh())
    } catch (_) {
      // clear the auth store on failed refresh
      event.locals.pb.authStore.clear()
    }

    this.user.set(event.locals.pb.authStore.model)

    if (event.url.pathname.startsWith(this.syncRoute)) {
      return await this.handleSync(event)
    }

    // clear the auth store if the user is not valid
    return false
  }

  private async handleSync({
    request,
    locals
  }: RequestEvent): Promise<Response> {
    const clientAuthStore = (await request.json()) as SyncJsonType

    if (locals.pb.authStore.isValid == clientAuthStore.isValid) {
      // console.log('No update needed')
      return json({
        hasUpdate: false
      })
    }

    if (clientAuthStore.isValid) {
      // console.log('Client is valid, updating server...')
      locals.pb.authStore.save(
        clientAuthStore.token || '',
        clientAuthStore.model
      )
      if (locals.pb.authStore.isValid) {
        // console.log('Server is now valid')
        const response = json({
          hasUpdate: false
        })
        response.headers.append(
          'set-cookie',
          locals.pb.authStore.exportToCookie()
        )
        return response
      }
    }

    // console.log('Client is not valid afterall, logging out...')
    locals.pb.authStore.clear()

    // in case we need to update, we can just update the client's auth store with the latest state
    const response = json({
      hasUpdate: true,
      token: locals.pb.authStore.token,
      model: locals.pb.authStore.model
    })
    response.headers.append('set-cookie', locals.pb.authStore.exportToCookie())

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

  /**
   * Hook for SvelteKit to handle fetch requests
   * It take handleFetch's input and return a response or false if the hook is not handled
   *
   * @example
   * ```js
   * // src/hooks.server.js
   * import { hookFetchHandler } from "$lib/db";
   * export async function handleFetch({ event, request, fetch }) {
   *   let response = await hookFetchHandler({ event, request, fetch });
   *   if (response !== false) {
   *     return response;
   *   }
   *
   *   return fetch(request);
   * }
   * ```
   */
  hookFetchHandler: HookFetchHandlerT = async ({ event, request, fetch }) => {
    if (request.url.startsWith(event.locals.pb.baseUrl)) {
      request.headers.set('Authorization', event.locals.pb.authStore.token)
      return fetch(request)
    }

    return false
  }
}
