import type { GoogleConnectionStore, GoogleOAuthGateway, GrantedTokens } from "./gateways";
import { GOOGLE_SCOPES } from "./google";

export type GoogleConnectionServices = { store: GoogleConnectionStore; oauth: GoogleOAuthGateway; now: () => Date };

/** The Admin has to connect Google again on the dashboard before anything can use it. */
export class GoogleConnectionError extends Error {}

// Refreshed this early, so a token never expires halfway through a request.
const EXPIRY_MARGIN_MS = 60_000;

const expiresAt = (granted: GrantedTokens, now: Date) => new Date(now.getTime() + granted.expiresInSeconds * 1000);

/** Saves the tokens Google grants for the OAuth callback's code, replacing any earlier connection. */
export async function connectGoogle({ store, oauth, now }: GoogleConnectionServices, code: string, redirectUri: string) {
  const granted = await oauth.exchange(code, redirectUri);
  await store.save({
    refreshToken: granted.refreshToken,
    accessToken: granted.accessToken,
    expiresAt: expiresAt(granted, now()),
    scopes: granted.scopes,
  });
}

/** A working access token for the Admin's Google account, refreshed and saved when it's about to expire. */
export async function googleAccessToken({ store, oauth, now }: GoogleConnectionServices) {
  const tokens = await store.get();
  if (!tokens) throw new GoogleConnectionError("Google isn't connected: connect Google on the dashboard's Google page");
  // A connection made before the agent asked for a scope, such as Gmail read access, has to be consented again.
  const missing = GOOGLE_SCOPES.filter((scope) => !tokens.scopes.includes(scope));
  if (missing.length > 0) {
    throw new GoogleConnectionError(
      `The agent needs more Google access (${missing.join(", ")}): reconnect Google on the dashboard's Google page`,
    );
  }
  if (tokens.expiresAt.getTime() - now().getTime() > EXPIRY_MARGIN_MS) return tokens.accessToken;

  const granted = await oauth.refresh(tokens.refreshToken);
  if (!granted) throw new GoogleConnectionError("Google no longer accepts the connection: reconnect Google on the dashboard's Google page");

  await store.save({
    refreshToken: granted.refreshToken ?? tokens.refreshToken,
    accessToken: granted.accessToken,
    expiresAt: expiresAt(granted, now()),
    scopes: tokens.scopes,
  });
  return granted.accessToken;
}
