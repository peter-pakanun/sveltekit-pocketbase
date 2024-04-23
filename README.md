# sveltekit-pocketbase

  A SvelteKit library to interact with PocketBase in both SSR and CSR environments.

## Why

  I want to use [PocketBase](https://pocketbase.io) in my [SvelteKit](https://kit.svelte.dev/) project, but by doing SSR or CSR only it defeat the purpose of Meta framework, every page load will trigger Serverless function (e.g., Cloudflare Pages) and thus, eat up the function invocation quota. The PocketBase API will be called either ways, so it's better if we can utilize the CSR to reduce the serverless function invocation. But if we do CSR only, the page will be rendered without the data, and the user will see a blank page for a moment, it's also not good for SEO, hence the need for both SSR and CSR.

  There's a lot of ways to interact with PocketBase in SvelteKit, but none of them that I can find can be used in both SSR and CSR environments. This library aims to provide a way to interact with PocketBase in both environments.

  It also comes with a Svelte store that show the user's model.

## How it work

  First, the library follow the same steps as [PocketBase JavaScript SDK's SSR Integration](https://github.com/pocketbase/js-sdk#ssr-integration) to authenticate the user each time the page is loaded in the server by checking the user's cookie. If the user is authenticated, the user's session will be stored in the server's `locals.pb` instance. This also trigger the $user store to be updated with the correct user's model.

  This ensures that the user's session is always available in the server if the client has valid cookie, and the `locals.pb` instance can be used to fetch the data in the server with the same credential as the client.

  Then, the library provides a way to sync the user's session with the server by create an internal route to handle the user's session. This route will be called each time the user's session is updated in the client, and the server will update the user's session accordingly.

  The library also comes with a Svelte store to read user model, which will be updated automatically each time the user's session is updated in the client.

  This mean you can use the `pb` instance on the client to first authenticate the user, and then use the `$user` store to read the user's information. The `pb` and `$user` can be use anywhere in the app—no matter if it's SSR or CSR mode—to fetch the data, login, logout, etc.

## Install

  Install the packages using npm:
  ```bash
  $ npm i -D pocketbase sveltekit-pocketbase
  ```

  Create `src/lib/db.ts` file and export the PocketBase instance.
  ```typescript
  // src/lib/db.ts
  import SvelteKitPocketBase from 'sveltekit-pocketbase';
  // generated using `pocketbase-typegen` package
  import type { TypedPocketBase, UsersResponse } from './dbtypes';

  const pbAdapter = new SvelteKitPocketBase<TypedPocketBase, UsersResponse>({
    // pocketbase server base url
    pbBaseUrl: "http://127.0.0.1:8090",
    // Route used internally for authentication syncing
    syncRoute: "/users/sync",
    // User collection name
    userCollection: "users",
  })

  export const pb = pbAdapter.pb;
  export const user = pbAdapter.user;
  export const hookHandler = pbAdapter.hookHandler;
  export const hookFetchHandler = pbAdapter.hookFetchHandler;
  ```

  Create `src/hooks.server.ts` file if not already exists and put in the handlers.
  ```typescript
  import { hookFetchHandler, hookHandler } from '$lib/db';
  import type { Handle, HandleFetch } from '@sveltejs/kit';

  export const handle: Handle = async ({ event, resolve }) => {
    let response = await hookHandler({ event, resolve });
    if (response !== false) {
      return response;
    }

    response = await resolve(event);

    return response;
  };

  export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
    const response = await hookFetchHandler({ event, request, fetch });
    if (response !== false) {
      return response;
    }

    return fetch(request);
  };
  ```

  This library put PocketBase client into server's `locals` object, so you need to define it in `src/app.d.ts` file.
  ```typescript
  import type { TypedPocketBase } from '$lib/dbtypes';

  // See https://kit.svelte.dev/docs/types#app
  // for information about these interfaces
  declare global {
    namespace App {
      // interface Error {}
      interface Locals {
        pb: TypedPocketBase;
      }
      // interface PageData {}
      // interface PageState {}
      // interface Platform {}
    }
  }

  export {};
  ```

## Svelte Store

  This library comes with a Svelte store to manage the user state.
  Beware, the store on the server is shared across all client, so you should not use the store directly in the server. More infomation can be found in the [SvelteKit documentation](https://kit.svelte.dev/docs/state-management#using-stores-with-context).
  Here's an example of one way to access the store safely:
  ```typescript
  // +layout.server.ts
  import type { UsersResponse } from '$lib/dbtypes';
  import type { LayoutServerLoad } from './$types';

  export const load = (async ({ locals }) => {
    return {
      user: locals.pb.authStore.model as UsersResponse,
    };
  }) satisfies LayoutServerLoad;
  ```

  And in `+layout.svelte` file:
  ```svelte
  <script lang="ts">
    import '../app.pcss';
    import { setContext } from 'svelte';
    import { user } from '$lib/db';

    export let data;

    $: user.set(data.user);
    setContext('user', user);
  </script>

  <slot></slot>
  ```

  Now you can get the `$user` store anywhere in the app to read the user's information.
  ```svelte
  <script lang="ts">
    import { pb } from '$lib/db';
    import type { user as UserStoreType } from '$lib/db';
    import { getContext } from 'svelte';

    const user = getContext<typeof UserStoreType>('user');
  </script>
  
  {#if $user}
    Logged in as {$user.email} <button on:click={() => pb.authStore.clear()}>Logout</button>
  {:else}
    <button on:click={() => pb.collection('users').authWithOAuth2({ provider: 'google' })}>Login with Google</button>
  {/if}
  ```

## Usage

  You can get the `pb` instance to interact with PocketBase in both SSR and CSR environments.
  Refer to the [PocketBase JavaScript SDK](https://github.com/pocketbase/js-sdk) for more information.
  
  The `pb` property of the class is a getter to get the `pb` instance. This is required because Cloudflare Workers does not support reuse of I/O objects across requests, so you need to create a new `pb` instance on the server each time you want to interact with PocketBase.

  Don't forget to supply SvelteKit `fetch` object so the library can attach authentication headers to the request by the server.

  Example Loading Data:
  ```typescript
  // src/routes/+page.ts
  import { pb } from '$lib/db';

  export const load = (async ({ fetch }) => {
    return {
      items: (await getPB().collection('posts').getList(1, 20, { fetch })).items,
    };
  }) satisfies PageLoad;
  ```
  ```svelte
  <!-- src/routes/+page.svelte -->
  <script lang="ts">
    export let data;
  </script>

  {#each data.items as item}
    <div>
      <h1>{item.id}</h1>
      <h2>{item.name}</h2>
    </div>
  {/each}
  ```
  In this example, the data loading was performed in `+page.js` which can be run in both SSR and CSR environments. If the user access the page for the first time, the data will be loaded by the server using client's cookie to authenticate with PocketBase API, rendered and sent to the client. But if users navigates to the page from another page within the app, the data will be fetched by the browser directly.

## Authentication

  To authenticate the user, you can use the same method as the PocketBase JavaScript SDK from the client. The library do not support authentication from the server at the moment.

  Example Login:
  ```javascript
  import { pb } from '$lib/db';
  // auth with email and password
  const { token, record } = await pb.collection('users').authWithPassword('test@example.com', '123456');
  // ...or auth with OAuth2
  const { token, record } = await pb.collection('users').authWithOAuth2({ provider: 'google' });
  ```

  Example Logout:
  ```javascript
  import { pb } from '$lib/db';
  pb.authStore.clear();
  ```

  Note: The user's session will be automatically synced with the server once the client initializes the library (first time the page is loaded), and each time the authStore changed.

## Contributing

  Feel free to contribute to this project. To get started, you can follow these steps:

  Clone the repository and install the dependencies.
  ```bash
  $ git clone https://github.com/peter-pakanun/sveltekit-pocketbase.git
  $ cd sveltekit-pocketbase
  $ npm install
  ```

  Build the package.
  ```bash
  $ npm run build
  ```

  Link the package to your project. (assuming you are in the root of your project and the package is in the same directory as your project)
  ```bash
  $ npm link ../sveltekit-pocketbase
  ```
