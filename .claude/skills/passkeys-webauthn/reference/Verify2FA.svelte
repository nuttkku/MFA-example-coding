<script>
  import { preventDefault } from '../lib/events.js';
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { api, ApiError } from '../lib/api.js';
  import { authStore } from '../lib/stores/auth.js';
  import { passkeysSupported, verifyWithPasskey, passkeyErrorMessage } from '../lib/passkeys.js';

  let code = $state('');
  let error = $state('');
  let submitting = $state(false);
  let passkeyAvailable = $state(false);

  onMount(async () => {
    if (!passkeysSupported()) return;
    try {
      passkeyAvailable = (await api.passkeys.twoFactorMethods()).passkey;
    } catch {
      passkeyAvailable = false;
    }
  });

  async function finish(result) {
    await authStore.refresh();
    push(result.mustChangePassword ? '/change-password' : '/dashboard');
  }

  async function handlePasskey() {
    error = '';
    submitting = true;
    try {
      await finish(await verifyWithPasskey());
    } catch (err) {
      error = passkeyErrorMessage(err, 'Passkey verification failed.');
    } finally {
      submitting = false;
    }
  }

  async function handleSubmit() {
    error = '';
    submitting = true;
    try {
      await finish(await api.verifyTwoFactor(code));
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Invalid verification code.';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="page page-narrow">
  <div class="card">
    <h1>Two-factor verification</h1>
    <p class="subtitle">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>

    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    <form onsubmit={preventDefault(handleSubmit)}>
      <div class="field">
        <label for="code">Verification code</label>
        <input
          id="code"
          bind:value={code}
          autocomplete="one-time-code"
          required
          placeholder="123456 or XXXX-XXXX"
        />
      </div>
      <button class="btn btn-block" type="submit" disabled={submitting}>
        {submitting ? 'Verifying…' : 'Verify'}
      </button>
    </form>

    {#if passkeyAvailable}
      <button class="btn btn-secondary btn-block" type="button" style="margin-top:0.75rem;" onclick={handlePasskey} disabled={submitting}>
        Use a passkey instead
      </button>
    {/if}
  </div>
</div>
