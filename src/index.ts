import PocketBase, { AuthModel } from 'pocketbase'
import {
  json,
  type MaybePromise,
  type RequestEvent,
  type ResolveOptions
} from '@sveltejs/kit'
import { writable, type Writable } from 'svelte/store'

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

  /**
   * User collection name
   * @default 'users'
   */
  userCollection?: string
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

export default class SvelteKitPocketBase<
  PBType extends PocketBase = PocketBase,
  UserModel = AuthModel
> {
  /**
   * The private PocketBase instance.
   * You can use this to access the PocketBase API.
   *
   * @see {@link https://github.com/pocketbase/js-sdk | PocketBase JS SDK}
   */
  private _pb: PBType

  /**
   * The user svelte store.
   * This store is synced with the `pb.authStore.model`
   */
  user: Writable<UserModel | null>

  private syncRoute: string
  private userCollection: string

  /**
   * Create a new SvelteKitPocketBase instance.
   *
   * @param options options for the SvelteKitPocketBase
   */
  constructor(options?: SvelteKitPocketBaseConfig) {
    const defaultOptions = {
      pbBaseUrl: 'http://127.0.0.1:8090',
      syncRoute: '/users/sync',
      userCollection: 'users'
    }
    const { pbBaseUrl, syncRoute, userCollection } = {
      ...defaultOptions,
      ...options
    }

    this.syncRoute = syncRoute
    this.userCollection = userCollection

    this._pb = new PocketBase(pbBaseUrl) as PBType

    if (import.meta.env.SSR) {
      // Disable auto cancellation on the server
      this._pb.autoCancellation(false)
    } else {
      // Auto update the user store in the browser
      this._pb.authStore.onChange(async (_token, model) => {
        await this.authSync()
        this.user.set(model as UserModel)
      })
    }

    this.user = writable<UserModel | null>(
      this._pb.authStore.model as UserModel
    )
  }

  /**
   * Get the PocketBase instance.
   * This is to avoid Cloudflare Workers' limitations on shared I/O.
   */
  get pb(): PBType {
    if (import.meta.env.SSR) {
      // Create a new PocketBase instance for each request, to avoid Cloudflare Workers' limitations on shared I/O
      const _pb = new PocketBase(this.pb.baseUrl) as PBType
      _pb.autoCancellation(false)
      return _pb
    }
    return this._pb
  }

  /**
   * Hook for SvelteKit to handle authentication
   * It take handle's input and return a response or false if the hook is not handled
   *
   * @example
   * ```typescript
   * // src/hooks.server.ts
   * import { hookHandler } from "$lib/db";
   * export const handle: Handle = async ({ event, resolve }) => {
   *   let response = await hookHandler({ event, resolve });
   *   if (response !== false) {
   *     return response;
   *   }
   *
   *   response = await resolve(event);
   *
   *   return response;
   * };
   * ```
   */
  hookHandler: HookHandlerT = async ({ event }) => {
    event.locals.pb = this.pb

    // load the store data from the request cookie string
    event.locals.pb.authStore.loadFromCookie(
      event.request.headers.get('cookie') || ''
    )

    try {
      // get an up-to-date auth store state by verifying and refreshing the loaded auth model (if any)
      event.locals.pb.authStore.isValid &&
        (await event.locals.pb.collection(this.userCollection).authRefresh())
    } catch (_) {
      // clear the auth store on failed refresh
      event.locals.pb.authStore.clear()
    }

    this.user.set(event.locals.pb.authStore.model as UserModel)

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
   * ```typescript
   * // src/hooks.server.ts
   * import { hookFetchHandler } from "$lib/db";
   * export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
   *   const response = await hookFetchHandler({ event, request, fetch });
   *   if (response !== false) {
   *     return response;
   *   }
   *
   *   return fetch(request);
   * };
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
