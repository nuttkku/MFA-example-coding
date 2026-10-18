-- Passkeys (WebAuthn Level 3 / FIDO2 CTAP2 public-key credentials). Only the
-- credential's public key is stored - the private key never leaves the user's
-- authenticator - so, unlike the TOTP secret, nothing here needs encrypting:
-- a leaked row cannot be used to sign in.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Credential ID as returned by the authenticator, base64url (RFC 4648 s.5).
  credential_id TEXT UNIQUE NOT NULL,
  -- COSE_Key (RFC 9052 s.7) public key, exactly as found in the attested
  -- credential data at registration.
  public_key BYTEA NOT NULL,
  -- Signature counter (WebAuthn s.6.1.1). Synced passkeys always report 0;
  -- a hardware key reporting a counter that goes backwards suggests a clone.
  sign_count BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  -- 'singleDevice' (bound to one authenticator) or 'multiDevice' (synced).
  device_type VARCHAR(16) NOT NULL,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  name VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);

-- Outstanding WebAuthn challenges, one row per ceremony. Kept server-side (the
-- browser only holds the row id in an httpOnly cookie) so each challenge can be
-- consumed exactly once with a DELETE ... RETURNING - a signed cookie alone
-- could be replayed any number of times until it expired.
-- user_id is NULL for passwordless login, where the user is not known until
-- the authenticator says which credential it used.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(16) NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at ON webauthn_challenges(expires_at);
