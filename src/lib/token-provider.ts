/**
 * GitHub credential provider — abstracts how we get authenticated requests.
 *
 * Supports two modes:
 *   1. PAT (personal access token) — static token from env var. Default mode.
 *   2. GitHub App — generates short-lived installation tokens from APP_ID,
 *      PRIVATE_KEY, and INSTALLATION_ID. Drop those env vars in and it
 *      switches automatically.
 *
 * Both return the same { token, remaining } shape so the rest of the
 * collector never needs to know which auth method is in use.
 */

let _provider: GitHubTokenProvider | undefined;

export interface TokenInfo {
  token: string;
  /** Seconds until the token expires (Infinity for PATs, ~3600 for App tokens). */
  expiresInSeconds: number;
}

export interface GitHubTokenProvider {
  /** Return a valid token, refreshing/renewing if needed. */
  getToken(): Promise<TokenInfo>;
  /** Human-readable label for logs. */
  label: string;
}

// ---------------------------------------------------------------------------
// PAT provider
// ---------------------------------------------------------------------------

export class PatTokenProvider implements GitHubTokenProvider {
  readonly label = 'pat';
  private readonly token: string;

  constructor(token: string) {
    if (!token) throw new Error('PAT token is empty');
    this.token = token;
  }

  async getToken(): Promise<TokenInfo> {
    return { token: this.token, expiresInSeconds: Infinity };
  }
}

// ---------------------------------------------------------------------------
// GitHub App provider (placeholder — implement when APP_ID etc. are available)
// ---------------------------------------------------------------------------

export class GitHubAppTokenProvider implements GitHubTokenProvider {
  readonly label = 'github-app';
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly installationId: string;
  private cached?: { token: string; expiresAt: number };

  constructor(appId: string, privateKey: string, installationId: string) {
    this.appId = appId;
    this.privateKey = privateKey;
    this.installationId = installationId;
  }

  async getToken(): Promise<TokenInfo> {
    // If we have a cached token that's still valid (> 60s buffer), return it.
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) {
      return { token: this.cached.token, expiresInSeconds: (this.cached.expiresAt - Date.now()) / 1000 };
    }

    // Implementation requires signing a JWT with PRIVATE_KEY, exchanging
    // it for an installation access token via POST /app/installations/{id}/access_tokens.
    // When ready, uncomment and wire up the crypto + fetch logic here.
    throw new Error(
      'GitHub App token exchange not yet implemented. ' +
      'Set OSSRANK_GITHUB_TOKEN (PAT) or implement the JWT + /access_tokens flow.'
    );
  }
}

// ---------------------------------------------------------------------------
// Factory — picks the right provider based on available env vars
// ---------------------------------------------------------------------------

export function createTokenProvider(token?: string): GitHubTokenProvider | null {
  // Return cached provider if already created.
  if (_provider) return _provider;

  // PAT mode — explicit token or env var.
  const resolved = token ?? process.env.OSSRANK_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  if (resolved) {
    _provider = new PatTokenProvider(resolved);
    return _provider;
  }

  // GitHub App mode — env vars present but no PAT.
  const appId = process.env.APP_ID;
  const privateKey = process.env.PRIVATE_KEY;
  const installationId = process.env.INSTALLATION_ID;
  if (appId && privateKey && installationId) {
    _provider = new GitHubAppTokenProvider(appId, privateKey, installationId);
    return _provider;
  }

  return null;
}
