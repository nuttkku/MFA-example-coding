<script>
  import { preventDefault } from '../lib/events.js';
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { authStore } from '../lib/stores/auth.js';
  import { api, ApiError } from '../lib/api.js';
  import { pendingBackupCodes } from '../lib/stores/backupCodes.js';
  import { passkeysSupported, registerPasskey, passkeyErrorMessage } from '../lib/passkeys.js';

  let error = $state('');
  let regenerating = $state(false);
  let code = $state('');

  const canUsePasskeys = passkeysSupported();
  let passkeys = $state([]);
  let passkeyName = $state('');
  let passkeyCode = $state('');
  let passkeyBusy = $state(false);
  let passkeyMessage = $state('');

  onMount(loadPasskeys);

  async function loadPasskeys() {
    try {
      passkeys = (await api.passkeys.list()).passkeys;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not load passkeys.';
    }
  }

  async function addPasskey() {
    error = '';
    passkeyMessage = '';
    passkeyBusy = true;
    try {
      await registerPasskey(passkeyCode.trim(), passkeyName.trim());
      passkeyMessage = 'Passkey added. You can now sign in with it from the login page.';
      passkeyName = '';
      passkeyCode = '';
      await loadPasskeys();
    } catch (err) {
      error = passkeyErrorMessage(err, 'Could not add the passkey.');
    } finally {
      passkeyBusy = false;
    }
  }

  async function removePasskey(passkey) {
    if (!confirm(`Remove the passkey "${passkey.name}"?`)) return;
    error = '';
    passkeyMessage = '';
    try {
      await api.passkeys.remove(passkey.id);
      passkeyMessage = 'Passkey removed.';
      await loadPasskeys();
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not remove the passkey.';
    }
  }

  const formatDate = (value) => (value ? new Date(value).toLocaleString() : 'Never');

  async function regenerate() {
    error = '';
    regenerating = true;
    try {
      const result = await api.regenerateBackupCodes(code.trim());
      pendingBackupCodes.set({ codes: result.backupCodes, nextRoute: '/profile' });
      push('/2fa/backup-codes');
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Something went wrong.';
    } finally {
      regenerating = false;
    }
  }
</script>

<div class="page page-narrow">
  <div class="card">
    <h1>Your profile</h1>

    {#if error}
      <div class="alert alert-error">{error}</div>
    {/if}

    <div class="stack">
      <div><strong>Name:</strong> {$authStore.user?.fullName}</div>
      <div><strong>Email:</strong> {$authStore.user?.email}</div>
      <div>
        <strong>Role:</strong>
        <span class="badge badge-{$authStore.user?.role}">{$authStore.user?.role}</span>
      </div>
      <div><strong>2FA status:</strong> <span class="badge badge-active">Enabled</span></div>
    </div>

    <p class="hint" style="margin: 1rem 0;">
      2FA is mandatory for every account and cannot be turned off from here. If you lose your
      device, ask an administrator to reset your 2FA so you can go through setup again (this also
      removes your passkeys).
    </p>

    <form onsubmit={preventDefault(regenerate)}>
      <div class="field">
        <label for="regen-code">Current code from your authenticator app</label>
        <input
          id="regen-code"
          bind:value={code}
          autocomplete="one-time-code"
          inputmode="numeric"
          required
          placeholder="123456"
        />
      </div>
      <button class="btn btn-secondary" type="submit" disabled={regenerating}>
        {regenerating ? 'Generating…' : 'Regenerate backup codes'}
      </button>
    </form>

    <h2 style="margin-top:1.75rem;">Passkeys</h2>
    <p class="hint" style="margin-top:0;">
      A passkey signs you in with your device's fingerprint, face or PIN instead of a password and
      code. It can also stand in for the authenticator code after a password or SSO sign-in.
    </p>

    {#if passkeyMessage}
      <div class="alert alert-success">{passkeyMessage}</div>
    {/if}

    {#if passkeys.length > 0}
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>Added</th><th>Last used</th><th></th></tr>
          </thead>
          <tbody>
            {#each passkeys as passkey (passkey.id)}
              <tr>
                <td>{passkey.name}</td>
                <td>{passkey.device_type === 'multiDevice' ? 'Synced' : 'This device only'}</td>
                <td>{formatDate(passkey.created_at)}</td>
                <td>{formatDate(passkey.last_used_at)}</td>
                <td>
                  <button class="btn btn-danger btn-sm" type="button" onclick={() => removePasskey(passkey)}>
                    Remove
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="hint">No passkeys yet.</p>
    {/if}

    {#if canUsePasskeys}
      <form onsubmit={preventDefault(addPasskey)} style="margin-top:1rem;">
        <div class="field">
          <label for="passkey-name">Passkey name</label>
          <input id="passkey-name" bind:value={passkeyName} required maxlength="64" placeholder="e.g. My laptop" />
        </div>
        <div class="field">
          <label for="passkey-code">Current code from your authenticator app</label>
          <input
            id="passkey-code"
            bind:value={passkeyCode}
            autocomplete="one-time-code"
            inputmode="numeric"
            required
            placeholder="123456"
          />
        </div>
        <button class="btn btn-secondary" type="submit" disabled={passkeyBusy}>
          {passkeyBusy ? 'Waiting for your device…' : 'Add a passkey'}
        </button>
      </form>
    {:else}
      <p class="hint">This browser does not support passkeys.</p>
    {/if}

    <div style="margin-top:1.5rem;">
      {#if $authStore.user?.hasPassword}
        <a href="#/change-password">Change password</a>
      {:else}
        <p class="hint" style="margin:0;">
          This account signs in via an external provider (SSO) and has no local password to change.
        </p>
      {/if}
    </div>
  </div>
</div>
