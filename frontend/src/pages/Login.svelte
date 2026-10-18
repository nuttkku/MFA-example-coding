<script>
  import { preventDefault } from '../lib/events.js';
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { api, ApiError } from '../lib/api.js';
  import { authStore } from '../lib/stores/auth.js';
  import { passkeysSupported, signInWithPasskey, passkeyErrorMessage } from '../lib/passkeys.js';

  const SSO_ERROR_MESSAGES = {
    unknown_provider: 'That sign-in method is not available.',
    sso_expired: 'That sign-in attempt expired, please try again.',
    sso_denied: 'Sign-in was cancelled or denied by the provider.',
    sso_failed: 'Sign-in failed, please try again.',
  };

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);
  let providers = $state([]);
  const showPasskey = passkeysSupported();

  onMount(async () => {
    const hash = window.location.hash;
    const queryIndex = hash.indexOf('?');
    if (queryIndex !== -1) {
      const params = new URLSearchParams(hash.slice(queryIndex + 1));
      const ssoError = params.get('error');
      if (ssoError) {
        error = SSO_ERROR_MESSAGES[ssoError] || 'Sign-in failed, please try again.';
        history.replaceState(null, '', window.location.pathname + window.location.search + '#/login');
      }
    }

    try {
      const result = await api.sso.listProviders();
      providers = result.providers;
    } catch {
      providers = [];
    }
  });

  async function handleSubmit() {
    error = '';
    loading = true;
    try {
      const result = await api.login(email, password);
      if (result.stage === 'setup_required') {
        push('/2fa/setup');
      } else {
        push('/2fa/verify');
      }
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
    } finally {
      loading = false;
    }
  }

  // Passwordless: a passkey verified with biometric/PIN is already
  // multi-factor, so a successful one goes straight to a full session.
  async function handlePasskey() {
    error = '';
    loading = true;
    try {
      const result = await signInWithPasskey();
      await authStore.refresh();
      push(result.mustChangePassword ? '/change-password' : '/dashboard');
    } catch (err) {
      error = passkeyErrorMessage(err, 'Passkey sign-in failed. Please try again.');
    } finally {
      loading = false;
    }
  }
</script>

<div class="page page-narrow">
  <div class="card">
    <h1>Sign in</h1>
    <p class="subtitle">
      Every account requires a second verification step after your password - or sign in with a
      passkey, which verifies both factors at once.
    </p>

    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    <form onsubmit={preventDefault(handleSubmit)}>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" bind:value={email} required autocomplete="username" />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" type="password" bind:value={password} required autocomplete="current-password" />
      </div>
      <button class="btn btn-block" type="submit" disabled={loading}>
        {loading ? 'Signing in…' : 'Continue'}
      </button>
    </form>

    {#if showPasskey}
      <button class="btn btn-secondary btn-block" type="button" style="margin-top:0.75rem;" onclick={handlePasskey} disabled={loading}>
        Sign in with a passkey
      </button>
    {/if}

    {#if providers.length > 0}
      <div class="stack" style="margin-top:1.25rem; padding-top:1.25rem; border-top:1px solid var(--color-border);">
        <p class="hint" style="margin:0 0 0.25rem;">Or continue with</p>
        {#each providers as provider (provider.id)}
          <a class="btn btn-secondary btn-block" href={api.sso.startUrl(provider.id)}>{provider.label}</a>
        {/each}
      </div>
    {/if}
  </div>
</div>
