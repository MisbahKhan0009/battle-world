import { describe, expect, test } from 'vitest';
import { parseClientSecret } from './clientSecret';

describe('client secret file', () => {
  test('reads a Desktop app client', () => {
    const file = JSON.stringify({
      installed: {
        client_id: '123-abc.apps.googleusercontent.com',
        project_id: 'flag-clash',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        client_secret: 'GOCSPX-secret',
        redirect_uris: ['http://localhost'],
      },
    });
    expect(parseClientSecret(file)).toEqual({
      clientId: '123-abc.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-secret',
    });
  });

  test('explains web clients and junk', () => {
    expect(() => parseClientSecret(JSON.stringify({ web: { client_id: 'x', client_secret: 'y' } }))).toThrow(
      /Desktop app/,
    );
    expect(() => parseClientSecret('not json')).toThrow(/not valid JSON/);
    expect(() => parseClientSecret('{}')).toThrow(/no client ID/);
  });
});
