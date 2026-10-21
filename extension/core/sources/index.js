/**
 * Public job-board APIs. Each source turns an ATS response into a list of
 * normalized postings.
 *
 * @typedef {object} Posting
 * @property {string} id
 * @property {string} title
 * @property {string} location        all locations joined with "; "
 * @property {string | null} url      public posting page
 * @property {string | null} createdAt  ISO date the posting was first published, if the API says
 * @property {string | null} updatedAt
 * @property {string | null} department
 * @property {string | null} salary   pay range text, if the API provides one
 * @property {string} text            plain-text description (truncated)
 *
 * @typedef {object} Source
 * @property {string} id
 * @property {(ref: {slug: string, region?: string | null}) => string} listUrl
 * @property {(json: any) => Posting[]} parse
 * @property {(ref: {slug: string, region?: string | null}) => string} boardUrl  human-facing board page
 */
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';
import { ashby } from './ashby.js';

/** @type {Record<string, Source>} */
export const SOURCES = { greenhouse, lever, ashby };

/** Hosts the extension needs permission for (keep in sync with manifest.json). */
export const SOURCE_HOSTS = [
  'boards-api.greenhouse.io',
  'boards-api.eu.greenhouse.io',
  'api.lever.co',
  'api.eu.lever.co',
  'api.ashbyhq.com',
];

