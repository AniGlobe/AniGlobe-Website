/**
 * Provider clearance table (task T023).
 *
 * Every provider we might talk to is listed here per capability, with the
 * decision, the basis we read it from, and the constraints we operate under.
 * The table is enforced in code: `requireClearance` refuses a capability the
 * table does not clear, so a provider cannot be wired in without a decision
 * recorded here first.
 *
 * Decisions:
 *   allow       : usable now.
 *   conditional : usable only while the recorded constraints hold.
 *   deny        : must not be used. Authorization would have to come first.
 *
 * These readings are our own, taken from each provider's published terms,
 * and are not legal advice.
 */

export const CAPABILITIES = [
  'mirror-catalogue',
  'lookup-title',
  'read-user-list',
  'write-user-list',
  'authenticate',
];

/** Reviewed on: the date we last read the linked terms. */
const REVIEWED = '2026-11-10';

export const PROVIDER_CLEARANCE = {
  kitsu: {
    label: 'Kitsu',
    terms: 'https://kitsu.docs.apiary.io/ (Kitsu JSON:API documentation)',
    capabilities: {
      'mirror-catalogue': {
        decision: 'conditional',
        basis: 'The API is published for third-party apps and documents rate limits; it does not grant a bulk dataset licence.',
        constraints: [
          'Crawl at most ' + '20 requests per minute (CATALOGUE_RATE_PER_MINUTE) and only as a daily incremental job.',
          'Store only the metadata fields the product displays; no synopses beyond what the detail view shows.',
          'Credit Kitsu as the catalogue source in the UI.',
          'Never publish the snapshot as a downloadable dataset.',
          'Re-review before the crawl rate or the stored field set grows materially.',
        ],
        reviewedOn: REVIEWED,
      },
      'lookup-title': {
        decision: 'conditional',
        basis: 'Single-title lookups are the documented use of the API.',
        constraints: ['Serve from the snapshot first; call the API only on a miss, and cache the result.'],
        reviewedOn: REVIEWED,
      },
      'read-user-list': {
        decision: 'deny',
        basis: 'Kitsu\'s own OAuth documentation states that application registration is not implemented and that the authorization code grant is "not yet implemented". The only flow the API offers is the password grant, which would mean asking users for their Kitsu password.',
        constraints: [
          'Do not ask a user for their Kitsu password.',
          'Reconsider only if Kitsu ships application registration and the authorization code grant.',
        ],
        reviewedOn: REVIEWED,
      },
      'write-user-list': {
        decision: 'deny',
        basis: 'Same reason as reading a user list: without application registration and the authorization code grant there is no delegated way to write a user library.',
        constraints: ['Do not ask a user for their Kitsu password.'],
        reviewedOn: REVIEWED,
      },
      authenticate: {
        decision: 'deny',
        basis: 'Sign-in only makes sense with the list capabilities above, which are denied.',
        constraints: ['Only usable together with a cleared list capability.'],
        reviewedOn: REVIEWED,
      },
    },
  },

  anilist: {
    label: 'AniList',
    terms: 'https://anilist.gitbook.io/anilist-apiv2-docs/docs/guide/terms-of-use',
    capabilities: {
      'mirror-catalogue': {
        decision: 'deny',
        basis: 'The API Terms of Use state that "Using the AniList API as a backup or data storage service is strictly prohibited" and that "Hoarding or mass collection of data from the AniList API is strictly prohibited".',
        constraints: ['Do not call the AniList API for catalogue data at all.'],
        reviewedOn: REVIEWED,
      },
      'lookup-title': {
        decision: 'deny',
        basis: 'The same prohibition covers caching API results as our own data store.',
        constraints: ['Do not call the AniList API for catalogue data at all.'],
        reviewedOn: REVIEWED,
      },
      'read-user-list': {
        decision: 'deny',
        basis: 'The API Terms of Use prohibit use "within competing noncomplementary services of the same nature", which lists anime/manga list/tracker services. Authorization is possible on request.',
        constraints: ['Only usable with written authorization from AniList.'],
        reviewedOn: REVIEWED,
      },
      'write-user-list': {
        decision: 'deny',
        basis: 'Same clause as reading a user list: a tracker service needs AniList\'s authorization.',
        constraints: ['Only usable with written authorization from AniList.'],
        reviewedOn: REVIEWED,
      },
      authenticate: {
        decision: 'deny',
        basis: 'Authentication is only useful for the list capabilities above, which are denied.',
        constraints: ['Only usable together with a cleared list capability.'],
        reviewedOn: REVIEWED,
      },
    },
  },

  mal: {
    label: 'MyAnimeList',
    terms: 'https://myanimelist.net/apiconfig/references/authorization (official API); Jikan is an unofficial wrapper',
    capabilities: {
      'mirror-catalogue': {
        decision: 'deny',
        basis: 'The official API does not grant a bulk dataset licence, and the Jikan wrapper we tested is not authorised by MAL for bulk crawling.',
        constraints: ['Do not build a catalogue snapshot from MAL or Jikan.'],
        reviewedOn: REVIEWED,
      },
      'lookup-title': {
        decision: 'conditional',
        basis: 'Single-title lookups through the official API with an approved client id are the documented use.',
        constraints: ['Use the official API with a client id, at most 60 requests per minute, and cache the result.'],
        reviewedOn: REVIEWED,
      },
      'read-user-list': {
        decision: 'conditional',
        basis: 'Reading your own MAL list needs an approved client id and an OAuth token for the user.',
        constraints: ['Register an approved client id and request only the scopes needed for the user\'s own list.'],
        reviewedOn: REVIEWED,
      },
      'write-user-list': {
        decision: 'conditional',
        basis: 'MAL\'s API can update the authenticated user\'s own list entries.',
        constraints: [
          'Register an approved client id.',
          'Write only the authenticated user\'s own entries, never another user\'s.',
        ],
        reviewedOn: REVIEWED,
      },
      authenticate: {
        decision: 'conditional',
        basis: 'OAuth needs an approved client id and a registered redirect URI.',
        constraints: ['Register an approved client id.'],
        reviewedOn: REVIEWED,
      },
    },
  },

  mangadex: {
    label: 'MangaDex',
    terms: 'https://api.mangadex.org/docs/',
    capabilities: {
      'mirror-catalogue': {
        decision: 'conditional',
        basis: 'The API is open and documents a global rate limit of roughly 5 requests per second plus a required descriptive User-Agent; it does not publish a dataset licence, so a full mirror stays a grey area.',
        constraints: [
          'Use only to fill manga gaps, never as the primary catalogue.',
          'Send a descriptive User-Agent with a contact address.',
          'Stay well under the documented rate limit and keep the crawl incremental.',
          'Re-check the documented limits before shipping the manga gap fill.',
        ],
        reviewedOn: REVIEWED,
      },
      'lookup-title': {
        decision: 'conditional',
        basis: 'Single-title lookups are the documented use of the API.',
        constraints: ['Send a descriptive User-Agent with a contact address; cache the result.'],
        reviewedOn: REVIEWED,
      },
      'read-user-list': {
        decision: 'deny',
        basis: 'MangaDex publishes no user-library API for third parties.',
        constraints: ['Do not attempt to read a MangaDex user library.'],
        reviewedOn: REVIEWED,
      },
      'write-user-list': {
        decision: 'deny',
        basis: 'MangaDex publishes no user-library API for third parties.',
        constraints: ['Do not attempt to write a MangaDex user library.'],
        reviewedOn: REVIEWED,
      },
      authenticate: {
        decision: 'deny',
        basis: 'MangaDex publishes no third-party user authentication for list features.',
        constraints: ['Do not attempt it.'],
        reviewedOn: REVIEWED,
      },
    },
  },
};

/** The clearance record for one provider capability. */
export function clearanceFor(providerId, capability) {
  const provider = PROVIDER_CLEARANCE[providerId];
  if (!provider) {
    return {
      provider: providerId,
      label: providerId,
      capability,
      decision: 'deny',
      basis: 'This provider is not on the clearance table, so it is not cleared.',
      constraints: [],
      reviewedOn: null,
    };
  }
  const record = provider.capabilities[capability];
  if (!record) {
    return {
      provider: providerId,
      label: provider.label,
      capability,
      decision: 'deny',
      basis: 'The provider is on the table, but this capability was never cleared.',
      constraints: [],
      reviewedOn: null,
    };
  }
  return { provider: providerId, label: provider.label, capability, terms: provider.terms, ...record };
}

/** True when the table allows the capability (allow, or conditional). */
export function isCleared(providerId, capability) {
  const record = clearanceFor(providerId, capability);
  return record.decision === 'allow' || record.decision === 'conditional';
}

/**
 * Refuse a capability the table does not clear. Call this before any
 * provider request, so an unclear provider can never be wired in by
 * accident.
 */
export function requireClearance(providerId, capability) {
  const record = clearanceFor(providerId, capability);
  if (record.decision === 'deny') {
    const error = new Error(
      'The clearance table does not allow ' + record.label + ' to be used for "' + capability + '". ' + record.basis
    );
    error.code = 'provider_not_cleared';
    error.clearance = record;
    throw error;
  }
  return record;
}

/** The whole table, for the operator endpoint and the docs. */
export function clearanceSummary() {
  return Object.keys(PROVIDER_CLEARANCE).map((providerId) => {
    const provider = PROVIDER_CLEARANCE[providerId];
    const capabilities = {};
    for (const capability of CAPABILITIES) {
      const record = provider.capabilities[capability];
      capabilities[capability] = record ? record.decision : 'deny';
    }
    return { provider: providerId, label: provider.label, terms: provider.terms, capabilities };
  });
}
