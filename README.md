# sveltekit-pocketbase

  A SvelteKit library to interact with PocketBase in both SSR and CSR environments.

## Why

  I want to use [PocketBase](https://pocketbase.io) in my [SvelteKit](https://kit.svelte.dev/) project, but by doing SSR or CSR only it defeat the purpose of Meta framework, every page load will trigger Serverless function (e.g., Cloudflare Pages) and thus, eat up the function invocation quota. The PocketBase API will be called either ways, so it's better if we can utilize the CSR to reduce the serverless function invocation. But if we do CSR only, the page will be rendered without the data, and the user will see a blank page for a moment, it's also not good for SEO, hence the need for both SSR and CSR.

  There's a lot of ways to interact with PocketBase in SvelteKit, but none of them that I can find can be used in both SSR and CSR environments. This library aims to provide a way to interact with PocketBase in both environments.

  It also comes with a Svelte store to manage the user state.

## How it work

  First, the library follow the same steps as [PocketBase JavaScript SDK's SSR Integration](https://github.com/pocketbase/js-sdk#ssr-integration) to authenticate the user each time the page is loaded in the server by checking the user's cookie. If the user is authenticated, the user's session will be stored in the server's `pb` instance.

  This ensures that the user's session is always available in the server if the client has valid cookie, and the `pb` instance can be used to fetch the data in the server with the same credential as the client.

  Then, the library provides a way to sync the user's session with the server by create an internal route to handle the user's session. This route will be called each time the user's session is updated in the client, and the server will update the user's session accordingly.

  The library also comes with a Svelte store to manage the user state, which will automatically sync the user's session with the server each time the store content is updated.

  This mean you can use the `pb` instance on the client to first authenticate the user, and then use the `$user` store to sync the user's session to server by simply updating the variable.

## Install

  Install the packages using npm:
  ```bash
  $ npm i -D pocketbase sveltekit-pocketbase
  ```

  Create `src/lib/db.js` file and export the PocketBase instance.
  ```javascript
  // src/lib/db.js
  import SvelteKitPocketBase from 'sveltekit-pocketbase';

  const pbAdapter = new SvelteKitPocketBase();

  export const pb = pbAdapter.pb;
  export const user = pbAdapter.user;
  export const handleHook = pbAdapter.handleHook;
  ```
  > Optionally, you can pass the `config` object to the `SvelteKitPocketBase` constructor.
  ```javascript
  const pbAdapter = new SvelteKitPocketBase({
    pbBaseUrl: "http://127.0.0.1:8090", // pocketbase server base url
    syncRoute: "/users/sync", // Route to use internally for authentication syncing
  })
  ```

  Create `src/hooks.server.js` file if not already exists and put in the hook handler.
  ```javascript
  import { hookHandler } from '$lib/db';

  /** @type {import('@sveltejs/kit').Handle} */
  export async function handle({ event, resolve }) {
    let response = await hookHandler({ event, resolve });
    if (response !== false) {
      return response;
    }

    response = await resolve(event);

    return response;
  }
  ```

## Svelte Store

  This library comes with a Svelte store to manage the user state.
  Here's an example of one way to access the store:

  1. Create a `src/lib/stores.js` file and export the user store.
  ```javascript
  import { user } from "$lib/db";
  // the rest of your stores...
  export { user, /* ... */ }
  ```
  > Note: as the pocketbase instance was already initialized in `src/lib/db.js`, you can directly import the `user` store from `db` instance.

  2. Use the store in your components.
  ```svelte
  <script>
    import { user } from '$lib/stores';
  </script>

  {#if $user}
    Logged in as {$user.email} <button on:click={() => $user = null}>Logout</button>
  {:else}
    <a href="/users/login">Login</a>
  {/if}
  ```

## Usage

  You can use the `pb` instance to interact with PocketBase in both SSR and CSR environments.
  Refer to the [PocketBase JavaScript SDK](https://github.com/pocketbase/js-sdk) for more information.

  Example Loading Data:
  ```javascript
  // src/routes/+page.js
  import { pb } from '$lib/db';

  /** @type {import('./$types').PageLoad} */
  export async function load() {
    return {
      items: (await pb.collection('test').getList(1, 10)).items,
    };
  };
  ```
  ```svelte
  <!-- src/routes/+page.svelte -->
  <script>
    /** @type {import('@sveltejs/kit').Load} */
    export let data;
    $: console.log(data);
  </script>
  ```
  ```
  > { items: [ { id: '1', name: 'test' } ] }
  ```
  In this example, the data loading was performed in `+page.js` which can be run in both SSR and CSR environments. If the user access the page for the first time, the data will be loaded in the server using client's cookie to authenticate with pocketbase API, rendered and sent to the client. If the user navigates to the page from another page within the app, the data will be fetched in the client directly.

## Authentication

  To authenticate the user, you can use the same method as the PocketBase JavaScript SDK. And after the user is authenticated, you must sync the user's session with the server by storing the user model in the user store.

  This must be done in the client, not in the server, because the server does not have access to the user's localstorage used internally by the PocketBase SDK.

  Example Login:
  ```javascript
  import { pb } from '$lib/db';

  // auth with email and password
  const { token, record } = await pb.collection('users').authWithPassword('test@example.com', '123456');

  // store the user model in the user store
  $user = record;
  ```

  To logout the user, you can simply set the user store to `null`. This will also trigger the sync route to remove the user's session from the server.

  ```javascript
  $user = null;
  ```

  Note: The user's session will be automatically synced with the server each time the client initializes the library (first time the page is loaded).

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