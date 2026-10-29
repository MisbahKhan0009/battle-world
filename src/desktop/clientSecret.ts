/**
 * Reads the client_secret_*.json file Google Cloud offers as "Download JSON" for an OAuth client.
 * Desktop clients look like {"installed": {"client_id": "...", "client_secret": "...", ...}}.
 */
export function parseClientSecret(text: string): { clientId: string; clientSecret: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      'This file is not valid JSON. Pick the client_secret_….json file you downloaded from Google.',
    );
  }
  const root = (json ?? {}) as Record<string, { client_id?: unknown; client_secret?: unknown } | undefined>;
  if (root.web && !root.installed)
    throw new Error(
      'This file is for a "Web application" client. Create a client of type "Desktop app" and download its JSON instead.',
    );
  const c = root.installed;
  if (
    !c ||
    typeof c.client_id !== 'string' ||
    typeof c.client_secret !== 'string' ||
    !c.client_id ||
    !c.client_secret
  )
    throw new Error(
      'This file has no client ID and secret. Download the JSON from your Desktop app client in Google Cloud.',
    );
  return { clientId: c.client_id.trim(), clientSecret: c.client_secret.trim() };
}

/** Opens a file picker for a client_secret JSON file and parses it. Resolves null if cancelled. */
export function pickClientSecretFile(): Promise<{ clientId: string; clientSecret: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > 64 * 1024)
        return reject(new Error('That file is too large to be a client secret file.'));
      file
        .text()
        .then((t) => resolve(parseClientSecret(t)))
        .catch(reject);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
