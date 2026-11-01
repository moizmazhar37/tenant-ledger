import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as getEntry } from '@/app/api/entries/[id]/route';
import { GET as listEntries } from '@/app/api/entries/route';
import { getDb } from '@/db/client';
import { sessions } from '@/db/schema';
import { SEED } from '@/db/seed';
import { getRequest, routeParams, sessionCookieFor, resetDatabaseBeforeEach } from './helpers';

resetDatabaseBeforeEach();

function requestEntry(id: string, cookie?: string) {
  return getEntry(getRequest(`/api/entries/${id}`, cookie), routeParams({ id }));
}

describe.each([
  { viewer: SEED.acme, owner: SEED.globex },
  { viewer: SEED.globex, owner: SEED.acme },
])('$viewer.organisation.name member via the API', ({ viewer, owner }) => {
  it(`gets 404 for an entry belonging to another organisation, with none of its data`, async () => {
    const cookie = await sessionCookieFor(viewer.member.id);
    for (const foreign of owner.entries) {
      const response = await requestEntry(foreign.id, cookie);
      const text = await response.text();
      expect(response.status).toBe(404);
      expect(JSON.parse(text)).toEqual({ error: 'not_found' });
      expect(text).not.toContain(foreign.description);
      expect(text).not.toContain(foreign.providerEventId);
    }
  });

  it('gets the same response for another tenant’s id as for an id that does not exist', async () => {
    const cookie = await sessionCookieFor(viewer.member.id);
    const foreign = await requestEntry(owner.entries[0].id, cookie);
    const missing = await requestEntry(randomUUID(), cookie);
    expect(foreign.status).toBe(missing.status);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it('can read its own entry (positive control)', async () => {
    const cookie = await sessionCookieFor(viewer.member.id);
    const own = viewer.entries[0];
    const response = await requestEntry(own.id, cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      entry: { id: own.id, organisationId: viewer.organisation.id, description: own.description },
    });
  });

  it('lists exactly its own entries', async () => {
    const cookie = await sessionCookieFor(viewer.member.id);
    const response = await listEntries(getRequest('/api/entries', cookie));
    const body = (await response.json()) as { entries: { id: string; organisationId: string }[] };
    expect(response.status).toBe(200);
    expect(body.entries.map((entry) => entry.id).sort()).toEqual(
      viewer.entries.map((entry) => entry.id).sort(),
    );
    expect(new Set(body.entries.map((entry) => entry.organisationId))).toEqual(
      new Set([viewer.organisation.id]),
    );
  });
});

describe('entries API authentication', () => {
  const entryId = SEED.acme.entries[0].id;

  it('answers 401 without a session cookie', async () => {
    expect((await requestEntry(entryId)).status).toBe(401);
    expect((await listEntries(getRequest('/api/entries'))).status).toBe(401);
  });

  it('answers 401 for a forged session token', async () => {
    expect((await requestEntry(entryId, 'tl_session=forged-token')).status).toBe(401);
  });

  it('answers 401 for an expired session', async () => {
    const cookie = await sessionCookieFor(SEED.acme.member.id);
    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.memberId, SEED.acme.member.id));
    expect((await requestEntry(entryId, cookie)).status).toBe(401);
  });

  it('answers 404, not 500, for a malformed entry id', async () => {
    const cookie = await sessionCookieFor(SEED.acme.member.id);
    expect((await requestEntry('not-a-uuid', cookie)).status).toBe(404);
  });
});
