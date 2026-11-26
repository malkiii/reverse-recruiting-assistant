import type {
  DriveFile,
  DriveFolder,
  DriveGateway,
  Email,
  GmailGateway,
  GmailReader,
  GoogleOAuthGateway,
  GrantedTokens,
  ThreadMessage,
} from "./gateways";

/** The only scopes the agent asks for: it sends Applications, reads their Gmail threads for replies, and reads the Resume Folder. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

/** The consent page. Offline access with a forced prompt, so Google always returns a refresh token. */
export function googleAuthUrl(clientId: string, redirectUri: string, state: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return url.toString();
}

export function googleOAuth(clientId: string, clientSecret: string): GoogleOAuthGateway {
  async function requestTokens(fields: Record<string, string>) {
    return fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...fields }),
    });
  }

  const granted = ({ access_token, expires_in, refresh_token }: TokenResponse): GrantedTokens => ({
    accessToken: access_token,
    expiresInSeconds: expires_in,
    ...(refresh_token && { refreshToken: refresh_token }),
  });

  return {
    async exchange(code: string, redirectUri: string) {
      const response = await requestTokens({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
      if (!response.ok) throw new Error(`Google refused the sign-in: ${response.status} ${await response.text()}`);
      const tokens = (await response.json()) as TokenResponse;
      const scopes = tokens.scope?.split(" ") ?? [];
      const missing = GOOGLE_SCOPES.filter((scope) => !scopes.includes(scope));
      if (missing.length > 0) throw new Error(`Google access wasn't granted for: ${missing.join(", ")}`);
      if (!tokens.refresh_token) throw new Error("Google returned no refresh token");
      return { ...granted(tokens), refreshToken: tokens.refresh_token, scopes };
    },

    async refresh(refreshToken: string) {
      const response = await requestTokens({ refresh_token: refreshToken, grant_type: "refresh_token" });
      if (response.status === 400) {
        const { error } = (await response.json()) as { error?: string };
        if (error === "invalid_grant") return null;
        throw new Error(`Google refused the token refresh: ${error}`);
      }
      if (!response.ok) throw new Error(`Google refused the token refresh: ${response.status} ${await response.text()}`);
      return granted((await response.json()) as TokenResponse);
    },
  };
}

export function googleDrive(accessToken: string): DriveGateway {
  async function get<T>(url: URL) {
    const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Google Drive refused the request: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  }

  async function listAll<T>(query: string, fields: string) {
    const files: T[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(DRIVE_FILES_URL);
      url.search = new URLSearchParams({
        q: `${query} and trashed = false`,
        fields: `nextPageToken, files(${fields})`,
        orderBy: "name",
        pageSize: "1000",
        ...(pageToken && { pageToken }),
      }).toString();
      const page = await get<{ files: T[]; nextPageToken?: string }>(url);
      files.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  return {
    listFolders() {
      return listAll<DriveFolder>(`mimeType = '${FOLDER}' and 'me' in owners`, "id, name");
    },

    listFiles(folderId: string) {
      return listAll<DriveFile>(`'${folderId.replaceAll("'", "\\'")}' in parents`, "id, name, mimeType, webViewLink");
    },

    async isSharedByLink(folderId: string) {
      const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(folderId)}`);
      url.searchParams.set("fields", "permissions(type, role)");
      const { permissions = [] } = await get<{ permissions?: { type: string; role: string }[] }>(url);
      return permissions.some(({ type }) => type === "anyone");
    },

    async download(fileId: string) {
      const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`);
      url.searchParams.set("alt", "media");
      const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error(`Google Drive refused the download: ${response.status} ${await response.text()}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** Line breaks would let a value add its own headers, so they're folded into spaces. */
const headerValue = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** An RFC 2822 plain text message, UTF-8 throughout. Gmail adds the From header for the Admin's account. */
export function mimeMessage({ to, subject, body }: Email) {
  const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
  return [
    `To: ${headerValue(to)}`,
    `Subject: =?UTF-8?B?${base64(headerValue(subject))}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64(body.replace(/\r?\n/g, "\r\n")),
  ].join("\r\n");
}

export function googleGmail(accessToken: string): GmailGateway {
  return {
    async send(email: Email) {
      const response = await fetch(GMAIL_SEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ raw: Buffer.from(mimeMessage(email), "utf8").toString("base64url") }),
      });
      if (!response.ok) throw new Error(`Gmail refused the email: ${response.status} ${await response.text()}`);
      const { id, threadId } = (await response.json()) as { id: string; threadId: string };
      return { messageId: id, threadId };
    },
  };
}

const GMAIL_THREADS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";

type GmailPart = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
};

export type GmailMessage = { id: string; labelIds?: string[]; internalDate: string; snippet?: string; payload: GmailPart };

/** The first part of the type, depth first, decoded. */
function partText(part: GmailPart, mimeType: string): string | undefined {
  if (part.mimeType === mimeType && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts ?? []) {
    const text = partText(child, mimeType);
    if (text !== undefined) return text;
  }
}

const htmlText = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

/** `"Jane Doe" <jane@acme.com>` as its name and address. The address stands for a missing name. */
function sender(from: string) {
  const match = from.match(/^\s*"?(.*?)"?\s*<([^>]+)>\s*$/);
  if (!match) return { fromName: from.trim(), fromEmail: from.trim() };
  const fromEmail = match[2].trim();
  return { fromName: match[1].trim() || fromEmail, fromEmail };
}

/** The HTML without the quoted earlier messages that mail clients put at its end. */
const htmlWithoutQuote = (html: string) =>
  html.replace(/<(div|blockquote)\b[^>]*\b(class="[^"]*gmail_quote|id="(divRplyFwdMsg|appendonsend)")[\s\S]*$/i, "");

/** How many lines an attribution such as "On …, Jane <jane@acme.com> wrote:" can wrap over. */
const ATTRIBUTION_LINES = 3;
/** How an attribution starts in common languages, so a wrapped one isn't searched above its first line. */
const ATTRIBUTION_START = /^\s*(On|Le|El|Am|Il|Op|Em)\s/;
/** A forwarded or replied-to message in Outlook's style. */
const ORIGINAL_MESSAGE = /^(-{2,}\s*original message\s*-{2,}|_{10,})\s*$/i;

/**
 * The reply's own text, without the earlier messages it quotes: the first block of "> " lines and the attribution line(s)
 * just above it, or an Outlook "Original Message", and everything after. The whole text when nothing would be left.
 */
export function withoutQuotedReply(text: string) {
  const lines = text.split(/\r?\n/);
  let end = lines.findIndex((line) => line.startsWith(">") || ORIGINAL_MESSAGE.test(line.trim()));
  if (end === -1) return text.trim();
  if (lines[end].startsWith(">")) {
    let above = end;
    while (above > 0 && lines[above - 1].trim() === "") above--;
    // The attribution ends with a colon, such as "wrote:", "a écrit :" or "schrieb:".
    if (above > 0 && lines[above - 1].trim().endsWith(":")) {
      let start = above - 1;
      while (
        start > 0 &&
        above - start < ATTRIBUTION_LINES &&
        !ATTRIBUTION_START.test(lines[start]) &&
        lines[start - 1].trim() !== ""
      ) {
        start--;
      }
      end = start;
    }
  }
  const own = lines.slice(0, end).join("\n").trim();
  return own === "" ? text.trim() : own;
}

/**
 * A Gmail API message, in the full format, as a thread message. Its plain text body is preferred over its HTML, and the
 * earlier messages it quotes are left out.
 */
export function threadMessage({ id, labelIds = [], internalDate, snippet, payload }: GmailMessage): ThreadMessage {
  const from = payload.headers?.find(({ name }) => name.toLowerCase() === "from")?.value ?? "";
  const html = partText(payload, "text/html");
  const text = partText(payload, "text/plain") ?? (html !== undefined ? htmlText(htmlWithoutQuote(html)) : (snippet ?? ""));
  return {
    gmailMessageId: id,
    ...sender(from),
    receivedAt: new Date(Number(internalDate)),
    text: withoutQuotedReply(text),
    fromAdmin: labelIds.includes("SENT") || labelIds.includes("DRAFT"),
  };
}

export function googleGmailReader(accessToken: string): GmailReader {
  return {
    async readThread(threadId: string) {
      const url = new URL(`${GMAIL_THREADS_URL}/${encodeURIComponent(threadId)}`);
      url.searchParams.set("format", "full");
      const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
      // The Admin deleted the thread, so there is nothing left to check.
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`Gmail refused to read the thread: ${response.status} ${await response.text()}`);
      const { messages = [] } = (await response.json()) as { messages?: GmailMessage[] };
      return messages.map(threadMessage);
    },
  };
}