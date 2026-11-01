'use strict';

const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { readFile } = require('node:fs/promises');

const API_BASE_URL = 'https://api.mangadex.org';
const ANILIST_API_URL = 'https://graphql.anilist.co';
const ANILIST_USER_AGENT = 'AniListMangaCatalog/1.0';
const PUBLIC_DIR = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const POPULAR_LIMIT = Number(process.env.MANGA_LIMIT || 12);
const LANGUAGE = process.env.MANGA_LANGUAGE || 'en';
const USER_AGENT = process.env.MANGADEX_USER_AGENT || 'MangaDexCatalog/1.0';
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_INTERVAL_MS = 250;
const MAX_RETRIES = 3;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ANILIST_QUERY = `
  query MangaCatalog($page: Int!, $perPage: Int!) {
    trending: Page(page: $page, perPage: $perPage) {
      media(type: MANGA, sort: TRENDING_DESC, isAdult: false) {
        id
        title { romaji english native }
        coverImage { extraLarge large }
        siteUrl
        chapters
        status
        updatedAt
      }
    }
    popular: Page(page: $page, perPage: $perPage) {
      media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) {
        id
        title { romaji english native }
        coverImage { extraLarge large }
        siteUrl
        chapters
        status
        updatedAt
      }
    }
    recent: Page(page: $page, perPage: $perPage) {
      media(type: MANGA, sort: UPDATED_AT_DESC, isAdult: false) {
        id
        title { romaji english native }
        coverImage { extraLarge large }
        siteUrl
        chapters
        status
        updatedAt
      }
    }
  }
`;
const ANILIST_MANGA_QUERY = `
  query MangaForReader($id: Int!) {
    Media(id: $id, type: MANGA) {
      id
      title { romaji english native }
      startDate { year }
      siteUrl
      description(asHtml: false)
      genres
      averageScore
      chapters
      volumes
      status
      coverImage { extraLarge large }
      characters(page: 1, perPage: 6, sort: [ROLE, FAVOURITES_DESC]) {
        edges {
          node {
            id
            name { full }
            image { large }
          }
        }
      }
      recommendations(page: 1, perPage: 8, sort: RATING_DESC) {
        nodes {
          mediaRecommendation {
            id
            type
            title { english romaji }
            coverImage { large }
            siteUrl
          }
        }
      }
    }
  }
`;
const ANILIST_SEARCH_QUERY = `
  query SearchManga($search: String!) {
    Page(page: 1, perPage: 10) {
      media(search: $search, type: MANGA, sort: SEARCH_MATCH, isAdult: false) {
        id
        title { romaji english native }
        coverImage { large }
        siteUrl
        chapters
        status
        updatedAt
      }
    }
  }
`;
const ANILIST_ALL_MANGA_QUERY = `
  query AllManga($page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        total
        currentPage
        lastPage
        hasNextPage
      }
      media(type: MANGA, sort: POPULARITY_DESC, isAdult: false) {
        id
        title { romaji english native }
        coverImage { extraLarge large }
        siteUrl
        chapters
        status
        updatedAt
      }
    }
  }
`;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

if (!Number.isInteger(POPULAR_LIMIT) || POPULAR_LIMIT < 1 || POPULAR_LIMIT > 50) {
  throw new Error('MANGA_LIMIT must be an integer between 1 and 50.');
}

class MangaDexError extends Error {
  constructor(message, statusCode = 502, requestId) {
    super(message);
    this.name = 'MangaDexError';
    this.statusCode = statusCode;
    this.requestId = requestId;
  }
}

class AniListError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'AniListError';
    this.statusCode = statusCode;
  }
}

let nextRequestAt = 0;
let cachedPayload;
let cacheExpiresAt = 0;
let payloadRequest;

function getRetryAfterMilliseconds(response, attempt) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }
  }

  return 500 * (2 ** attempt);
}

async function fetchAniListGraphQL(query, variables) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetch(ANILIST_API_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': ANILIST_USER_AGENT,
        },
        body: JSON.stringify({
          query,
          variables,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new AniListError(`AniList request failed: ${error.message}`);
      }
      await delay(500 * (2 ** attempt));
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_RETRIES) {
        await delay(getRetryAfterMilliseconds(response, attempt));
        continue;
      }
    }

    const responseText = await response.text();
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      const message = response.ok
        ? `AniList returned invalid JSON: ${error.message}`
        : `AniList returned HTTP ${response.status}: ${responseText.slice(0, 500)}`;
      throw new AniListError(message, response.ok ? 502 : response.status);
    }

    if (!response.ok) {
      throw new AniListError(
        `AniList returned HTTP ${response.status}: ${responseText.slice(0, 500)}`,
        response.status,
      );
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const messages = payload.errors.map((item) => item.message).filter(Boolean);
      throw new AniListError(`AniList GraphQL error: ${messages.join('; ') || 'Unknown error.'}`);
    }

    return payload.data;
  }

  throw new AniListError('AniList request failed after retrying.');
}

async function fetchAniListCatalog() {
  const data = await fetchAniListGraphQL(ANILIST_QUERY, {
    page: 1,
    perPage: Math.min(POPULAR_LIMIT, 50),
  });
  const { trending, popular, recent } = data || {};
  if (![trending, popular, recent].every((page) => Array.isArray(page?.media))) {
    throw new AniListError('AniList returned an invalid manga collection.');
  }

  const row = (key, title, media) => ({
    key,
    title,
    row_item: media.map(mapAniListManga),
  });

  return {
    source: 'AniList',
    generatedAt: new Date().toISOString(),
    row_track: [
      row('popular', 'Most Popular', popular.media),
      row('trending', 'Trending', trending.media),
      row('latest', 'Recently Updated in AniList', recent.media),
      {
        key: 'upcoming',
        title: 'Upcoming Chapter',
        row_item: [],
      },
    ],
  };
}

async function searchAniListManga(search) {
  const data = await fetchAniListGraphQL(ANILIST_SEARCH_QUERY, { search });
  if (!Array.isArray(data?.Page?.media)) {
    throw new AniListError('AniList returned invalid manga search results.');
  }
  return data.Page.media.map(mapAniListManga);
}

async function fetchAllMangaPage(page) {
  const data = await fetchAniListGraphQL(ANILIST_ALL_MANGA_QUERY, {
    page,
    perPage: 50,
  });
  const result = data?.Page;
  if (!Array.isArray(result?.media) || !result?.pageInfo) {
    throw new AniListError('AniList returned an invalid all manga page.');
  }

  return {
    source: 'AniList',
    pageInfo: result.pageInfo,
    row_item: result.media.map(mapAniListManga),
  };
}

function mapAniListManga(media) {
  const chapterCount = Number.isInteger(media.chapters) ? media.chapters : null;
  const updatedDate = media.updatedAt
    ? new Date(media.updatedAt * 1000).toISOString().slice(0, 10)
    : null;

  return {
    id: String(media.id),
    title: media.title?.english || media.title?.romaji || media.title?.native || 'Untitled manga',
    coverUrl: media.coverImage?.extraLarge || media.coverImage?.large || null,
    url: media.siteUrl || `https://anilist.co/manga/${media.id}`,
    status: media.status || null,
    latestChapter: chapterCount === null
      ? null
      : {
          chapter: chapterCount,
          label: `AniList lists ${chapterCount} chapters`,
          title: updatedDate ? `AniList record updated ${updatedDate}` : '',
          badge: `${chapterCount} CHAPTERS`,
          url: media.siteUrl || `https://anilist.co/manga/${media.id}`,
        },
    upcomingChapter: null,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForRequestSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + REQUEST_INTERVAL_MS;
  return wait === 0 ? Promise.resolve() : delay(wait);
}

function getRetryDelay(response, attempt) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }
  }

  return 500 * (2 ** attempt);
}

async function fetchMangaDexJson(endpoint, query) {
  const url = new URL(endpoint, API_BASE_URL);
  url.search = query.toString();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await waitForRequestSlot();

    let response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw new MangaDexError(`MangaDex request failed: ${error.message}`);
      }
      await delay(500 * (2 ** attempt));
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_RETRIES) {
        await delay(getRetryDelay(response, attempt));
        continue;
      }
    }

    if (!response.ok) {
      const body = await response.text();
      const detail = body.slice(0, 500);
      throw new MangaDexError(
        `MangaDex returned HTTP ${response.status}: ${detail}`,
        502,
        response.headers.get('x-request-id') || undefined,
      );
    }

    try {
      return await response.json();
    } catch (error) {
      throw new MangaDexError(`MangaDex returned invalid JSON: ${error.message}`);
    }
  }

  throw new MangaDexError('MangaDex request failed after retrying.');
}

function localizedValue(values) {
  if (!values || typeof values !== 'object') {
    return '';
  }
  return values[LANGUAGE] || values.en || Object.values(values)[0] || '';
}

function safeExternalUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function coverUrl(manga) {
  const cover = manga.relationships?.find((relationship) => relationship.type === 'cover_art');
  const fileName = cover?.attributes?.fileName;
  return fileName
    ? `/api/covers/${manga.id}/${encodeURIComponent(fileName)}`
    : null;
}

function formatChapter(chapter) {
  if (!chapter) {
    return null;
  }

  const attributes = chapter.attributes;
  return {
    id: chapter.id,
    chapter: attributes.chapter,
    volume: attributes.volume,
    title: attributes.title || '',
    language: attributes.translatedLanguage,
    publishAt: attributes.publishAt,
    readableAt: attributes.readableAt,
    pages: attributes.pages,
    externalUrl: safeExternalUrl(attributes.externalUrl),
    url: `https://mangadex.org/chapter/${chapter.id}`,
  };
}

async function fetchMangaChapters(mangaId) {
  const chapters = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const query = new URLSearchParams({
      manga: mangaId,
      limit: '100',
      offset: String(offset),
      'order[readableAt]': 'desc',
    });
    query.append('translatedLanguage[]', LANGUAGE);
    query.append('includes[]', 'scanlation_group');

    const response = await fetchMangaDexJson('/chapter', query);
    if (!Array.isArray(response.data) || !Number.isInteger(response.total)) {
      throw new MangaDexError('MangaDex returned an invalid chapter collection.');
    }

    chapters.push(...response.data);
    total = response.total;
    if (response.data.length === 0) {
      break;
    }
    offset += response.data.length;
  }

  return chapters.map((chapter) => {
    const formatted = formatChapter(chapter);
    const group = chapter.relationships?.find((relationship) => relationship.type === 'scanlation_group');
    return {
      ...formatted,
      group: group
        ? {
            id: group.id,
            name: group.attributes?.name || 'Scanlation group',
            url: `https://mangadex.org/group/${group.id}`,
          }
        : null,
    };
  });
}

function normalizeTitle(title) {
  return title
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const mangaMatchCache = new Map();

async function findMangaDexMatch(media) {
  const titleOptions = [
    ...(typeof media.title === 'string'
      ? [media.title, media.romajiTitle, media.nativeTitle]
      : [media.title?.english, media.title?.romaji, media.title?.native]),
  ].filter((title, index, titles) => (
    typeof title === 'string'
    && title.trim()
    && titles.indexOf(title) === index
  ));
  const normalizedOptions = new Set(titleOptions.map(normalizeTitle));
  const candidates = new Map();

  for (const title of titleOptions) {
    const query = new URLSearchParams({ title, limit: '10' });
    query.append('includes[]', 'cover_art');
    const response = await fetchMangaDexJson('/manga', query);
    if (!Array.isArray(response.data)) {
      throw new MangaDexError('MangaDex returned an invalid manga search result.');
    }

    response.data.forEach((manga) => candidates.set(manga.id, manga));
  }

  const matches = [];
  for (const manga of candidates.values()) {
    const attributes = manga.attributes;
    const primaryTitles = Object.values(attributes.title || {}).map(normalizeTitle);
    const mangaTitles = [
      ...primaryTitles,
      ...(attributes.altTitles || []).flatMap((titles) => Object.values(titles)),
    ].map(normalizeTitle);
    if (!mangaTitles.some((title) => normalizedOptions.has(title))) {
      continue;
    }

    const primaryTitleMatches = primaryTitles.some((title) => normalizedOptions.has(title));
    const yearMatches = media.startDate?.year
      && attributes.year === media.startDate.year;
    const yearConflicts = media.startDate?.year
      && attributes.year
      && attributes.year !== media.startDate.year;
    matches.push({
      manga,
      score: 100 + (primaryTitleMatches ? 10 : 0)
        + (yearMatches ? 5 : 0) - (yearConflicts ? 5 : 0),
      alternateTitleCount: (attributes.altTitles || []).length,
    });
  }

  matches.sort((left, right) => (
    right.score - left.score || right.alternateTitleCount - left.alternateTitleCount
  ));
  if (matches.length === 0) {
    throw new MangaDexError(
      `No confident MangaDex title match was found for "${titleOptions[0] || media.id}".`,
      404,
    );
  }
  if (
    matches.length > 1
    && matches[0].score === matches[1].score
    && matches[0].alternateTitleCount === matches[1].alternateTitleCount
  ) {
    throw new MangaDexError(
      `More than one MangaDex title matches "${titleOptions[0] || media.id}".`,
      409,
    );
  }

  return matches[0].manga;
}

async function fetchAniListMangaChapters(anilistId) {
  const media = await fetchAniListMangaDetails(anilistId);
  const id = media.id;
  const cachedMatch = mangaMatchCache.get(String(id));
  let mangaPromise;
  if (cachedMatch && cachedMatch.expiresAt > Date.now()) {
    mangaPromise = cachedMatch.promise;
  } else {
    mangaPromise = findMangaDexMatch(media).catch((error) => {
      mangaMatchCache.delete(String(id));
      throw error;
    });
    mangaMatchCache.set(String(id), {
      promise: mangaPromise,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
  }

  const manga = await mangaPromise;
  const chapters = await fetchMangaChapters(manga.id);
  return {
    anilistTitle: typeof media.title === 'string'
      ? media.title
      : media.title.english || media.title.romaji || media.title.native,
    manga: {
      id: manga.id,
      title: localizedValue(manga.attributes.title) || 'Untitled manga',
      url: `https://mangadex.org/title/${manga.id}`,
    },
    chapters,
  };
}

async function fetchAniListMangaDetails(anilistId) {
  const id = Number(anilistId);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new AniListError('AniList manga ID must be a positive safe integer.', 400);
  }

  const data = await fetchAniListGraphQL(ANILIST_MANGA_QUERY, { id });
  const media = data?.Media;
  if (!media?.id || !media.title) {
    throw new AniListError(`AniList manga ${anilistId} was not found.`, 404);
  }
  return {
    id: media.id,
    title: media.title.english || media.title.romaji || media.title.native || 'Untitled manga',
    romajiTitle: media.title.romaji || '',
    nativeTitle: media.title.native || '',
    siteUrl: media.siteUrl || `https://anilist.co/manga/${media.id}`,
    coverUrl: media.coverImage?.extraLarge || media.coverImage?.large || null,
    description: media.description || '',
    genres: Array.isArray(media.genres) ? media.genres : [],
    score: media.averageScore,
    chapters: media.chapters,
    volumes: media.volumes,
    status: media.status || 'UNKNOWN',
    year: media.startDate?.year || null,
    characters: Array.isArray(media.characters?.edges)
      ? media.characters.edges
        .filter((edge) => edge?.node?.id && edge.node.name?.full)
        .map((edge) => ({
          id: edge.node.id,
          name: edge.node.name.full,
          imageUrl: edge.node.image?.large || null,
        }))
      : [],
    recommendations: Array.isArray(media.recommendations?.nodes)
      ? media.recommendations.nodes
        .map((recommendation) => recommendation?.mediaRecommendation)
        .filter((recommended) => recommended?.id && recommended.type === 'MANGA')
        .map((recommended) => ({
          id: recommended.id,
          title: recommended.title.english || recommended.title.romaji || 'Untitled manga',
          coverUrl: recommended.coverImage?.large || null,
          siteUrl: recommended.siteUrl || `https://anilist.co/manga/${recommended.id}`,
        }))
      : [],
  };
}

const readerChapterCache = new Map();

async function fetchReaderChapter(chapterId) {
  const chapterQuery = new URLSearchParams();
  chapterQuery.append('includes[]', 'scanlation_group');
  chapterQuery.append('includes[]', 'manga');

  const chapterResponse = await fetchMangaDexJson(`/chapter/${chapterId}`, chapterQuery);
  const chapter = chapterResponse.data;
  if (!chapter?.attributes || !Array.isArray(chapter.relationships)) {
    throw new MangaDexError('MangaDex returned invalid chapter details.');
  }

  const mangaRelation = chapter.relationships.find((relationship) => relationship.type === 'manga');
  if (!mangaRelation) {
    throw new MangaDexError('This chapter is not linked to a manga.');
  }

  const groupRelation = chapter.relationships.find((relationship) => relationship.type === 'scanlation_group');
  const mangaQuery = new URLSearchParams();
  mangaQuery.append('includes[]', 'cover_art');

  const [mangaResponse, atHome] = await Promise.all([
    fetchMangaDexJson(`/manga/${mangaRelation.id}`, mangaQuery),
    chapter.attributes.pages > 0 && !chapter.attributes.externalUrl
      ? getAtHomeChapter(chapterId)
      : Promise.resolve(null),
  ]);
  const manga = mangaResponse.data;

  if (!manga?.attributes) {
    throw new MangaDexError('MangaDex returned invalid manga details.');
  }

  const files = atHome?.chapter?.dataSaver?.length
    ? atHome.chapter.dataSaver
    : atHome?.chapter?.data || [];
  const quality = atHome?.chapter?.dataSaver?.length ? 'data-saver' : 'data';

  return {
    chapter: {
      ...formatChapter(chapter),
      group: groupRelation
        ? {
            id: groupRelation.id,
            name: groupRelation.attributes?.name || 'Scanlation group',
            url: `https://mangadex.org/group/${groupRelation.id}`,
          }
        : null,
    },
    manga: {
      id: manga.id,
      title: localizedValue(manga.attributes.title) || 'Untitled manga',
      coverUrl: coverUrl(manga),
      url: `https://mangadex.org/title/${manga.id}`,
    },
    pages: files.map((file, index) => ({
      index,
      url: `/api/reader-pages/${chapterId}/${quality}/${index}`,
    })),
    readerUrl: `https://mangadex.org/chapter/${chapterId}`,
  };
}

function getAtHomeChapter(chapterId) {
  const cached = readerChapterCache.get(chapterId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = fetchMangaDexJson(`/at-home/server/${chapterId}`, new URLSearchParams())
    .then((response) => {
      if (
        !response.baseUrl
        || !response.chapter?.hash
        || (!Array.isArray(response.chapter.data) && !Array.isArray(response.chapter.dataSaver))
      ) {
        throw new MangaDexError('MangaDex has no readable pages for this chapter.', 404);
      }

      const base = new URL(response.baseUrl);
      if (!base.hostname.endsWith('.mangadex.network')) {
        throw new MangaDexError('MangaDex returned an untrusted chapter image host.');
      }

      return response;
    })
    .catch((error) => {
      readerChapterCache.delete(chapterId);
      throw error;
    });

  readerChapterCache.set(chapterId, {
    promise,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  return promise;
}

async function fetchCatalog() {
  return fetchAniListCatalog();
}

async function getCatalog() {
  if (cachedPayload && Date.now() < cacheExpiresAt) {
    return cachedPayload;
  }

  if (!payloadRequest) {
    payloadRequest = fetchCatalog()
      .then((payload) => {
        cachedPayload = payload;
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
        return payload;
      })
      .finally(() => {
        payloadRequest = null;
      });
  }

  return payloadRequest;
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function sendApiError(response, error, context) {
  console.error(context, error);
  sendJson(response, error.statusCode || 502, {
    error: error instanceof AniListError
      ? 'Unable to load manga data from AniList.'
      : 'Unable to load manga data from MangaDex.',
    message: error.message,
    requestId: error.requestId || null,
  });
}

async function fetchImageAsset(url, allowedHost) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:' || !allowedHost(parsedUrl.hostname)) {
    throw new MangaDexError('Refusing to fetch an image from an untrusted host.', 400);
  }

  const imageResponse = await fetch(parsedUrl, {
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!imageResponse.ok) {
    throw new MangaDexError(`MangaDex image server returned HTTP ${imageResponse.status}.`);
  }

  const contentType = imageResponse.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new MangaDexError('MangaDex image server returned a non-image response.');
  }

  return {
    body: Buffer.from(await imageResponse.arrayBuffer()),
    contentType,
  };
}

function sendImage(response, image) {
  response.writeHead(200, {
    'Content-Type': image.contentType,
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(image.body);
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function serveStatic(request, response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end('Invalid URL path.');
    return;
  }

  const relativePath = decodedPath === '/' ? 'home.html' : decodedPath.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(403).end('Forbidden.');
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      response.writeHead(404).end('Not found.');
      return;
    }
    throw error;
  }
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  const chapterListMatch = requestUrl.pathname.match(
    /^\/api\/manga\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/chapters$/i,
  );
  if (chapterListMatch) {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end('Method not allowed.');
      return;
    }

    fetchMangaChapters(chapterListMatch[1])
      .then((chapters) => sendJson(response, 200, { chapters }))
      .catch((error) => sendApiError(response, error, 'Unable to load chapter list:'));
    return;
  }

  const aniListChaptersMatch = requestUrl.pathname.match(
    /^\/api\/anilist-manga\/(\d+)\/chapters$/,
  );
  if (aniListChaptersMatch) {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end('Method not allowed.');
      return;
    }

    fetchAniListMangaChapters(aniListChaptersMatch[1])
      .then((payload) => sendJson(response, 200, payload))
      .catch((error) => sendApiError(response, error, 'Unable to find MangaDex chapters for AniList manga:'));
    return;
  }

  const aniListDetailsMatch = requestUrl.pathname.match(/^\/api\/anilist-manga\/(\d+)$/);
  if (aniListDetailsMatch) {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end('Method not allowed.');
      return;
    }

    fetchAniListMangaDetails(aniListDetailsMatch[1])
      .then((manga) => sendJson(response, 200, { manga }))
      .catch((error) => sendApiError(response, error, 'Unable to load AniList manga details:'));
    return;
  }

  if (requestUrl.pathname === '/api/search') {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end('Method not allowed.');
      return;
    }

    const search = (requestUrl.searchParams.get('q') || '').trim();
    if (search.length < 2 || search.length > 100) {
      sendJson(response, 200, { results: [] });
      return;
    }

    searchAniListManga(search)
      .then((results) => sendJson(response, 200, { results }))
      .catch((error) => sendApiError(response, error, 'Unable to search AniList manga:'));
    return;
  }

  const readerMatch = requestUrl.pathname.match(
    /^\/api\/reader\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i,
  );
  if (readerMatch) {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end('Method not allowed.');
      return;
    }

    fetchReaderChapter(readerMatch[1])
      .then((payload) => sendJson(response, 200, payload))
      .catch((error) => sendApiError(response, error, 'Unable to load reader chapter:'));
    return;
  }

  const coverMatch = requestUrl.pathname.match(
    /^\/api\/covers\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/([^/]+)$/i,
  );
  if (coverMatch) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed.');
      return;
    }

    let fileName;
    try {
      fileName = decodeURIComponent(coverMatch[2]);
    } catch {
      response.writeHead(400).end('Invalid cover file name.');
      return;
    }

    if (!/^[a-z0-9._-]{1,200}$/i.test(fileName) || fileName === '.' || fileName === '..') {
      response.writeHead(400).end('Invalid cover file name.');
      return;
    }

    const url = `https://uploads.mangadex.org/covers/${coverMatch[1]}/${encodeURIComponent(fileName)}.256.jpg`;
    fetchImageAsset(url, (hostname) => hostname === 'uploads.mangadex.org')
      .then((image) => sendImage(response, request.method === 'HEAD' ? { ...image, body: Buffer.alloc(0) } : image))
      .catch((error) => sendApiError(response, error, 'Unable to load manga cover:'));
    return;
  }

  const readerPageMatch = requestUrl.pathname.match(
    /^\/api\/reader-pages\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/(data|data-saver)\/(\d+)$/i,
  );
  if (readerPageMatch) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed.');
      return;
    }

    const [, chapterId, requestedQuality, pageIndexText] = readerPageMatch;
    const pageIndex = Number(pageIndexText);
    getAtHomeChapter(chapterId)
      .then((atHome) => {
        const quality = requestedQuality === 'data-saver' && atHome.chapter.dataSaver?.length
          ? 'data-saver'
          : 'data';
        const pages = quality === 'data-saver'
          ? atHome.chapter.dataSaver
          : atHome.chapter.data;
        const filename = pages[pageIndex];
        if (!filename) {
          response.writeHead(404).end('Reader page not found.');
          return null;
        }

        const url = `${atHome.baseUrl}/${quality}/${encodeURIComponent(atHome.chapter.hash)}/${encodeURIComponent(filename)}`;
        return fetchImageAsset(url, (hostname) => hostname.endsWith('.mangadex.network'));
      })
      .then((image) => {
        if (image) {
          sendImage(response, request.method === 'HEAD' ? { ...image, body: Buffer.alloc(0) } : image);
        }
      })
      .catch((error) => sendApiError(response, error, 'Unable to load reader page:'));
    return;
  }

  if (requestUrl.pathname === '/api/manga/all') {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end('Method not allowed.');
      return;
    }

    const pageText = requestUrl.searchParams.get('page') || '1';
    if (!/^\d+$/.test(pageText) || Number(pageText) < 1 || Number(pageText) > 10000) {
      sendJson(response, 400, { message: 'Page must be an integer between 1 and 10000.' });
      return;
    }

    fetchAllMangaPage(Number(pageText))
      .then((payload) => sendJson(response, 200, payload))
      .catch((error) => sendApiError(response, error, 'Unable to load AniList manga page:'));
    return;
  }

  if (requestUrl.pathname === '/api/manga') {
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end('Method not allowed.');
      return;
    }

    getCatalog()
      .then((payload) => sendJson(response, 200, payload))
      .catch((error) => {
        sendApiError(response, error, 'Unable to build AniList catalog:');
      });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed.');
    return;
  }

  serveStatic(request, response, requestUrl.pathname).catch((error) => {
    console.error('Unable to serve static file:', error);
    if (!response.headersSent) {
      response.writeHead(500).end('Internal server error.');
    } else {
      response.destroy(error);
    }
  });
});

function openBrowser(url) {
  let command;
  let args;

  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const browser = spawn(command, args, { detached: true, stdio: 'ignore' });
  browser.once('error', (error) => {
    console.error(`Could not open a browser automatically: ${error.message}`);
    console.log(`Open ${url} in your browser.`);
  });
  browser.unref();
}

if (require.main === module) {
  const url = `http://localhost:${PORT}`;

  server.once('error', (error) => {
    if (error.code !== 'EADDRINUSE') {
      console.error('Unable to start the AniList catalog server:', error);
      process.exitCode = 1;
      return;
    }

    fetch(`${url}/api/manga`, { signal: AbortSignal.timeout(3000) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload.source !== 'AniList') {
          throw new Error('Another application is using the configured port.');
        }

        console.log(`AniList catalog is already running at ${url}`);
        if (process.argv.includes('--open')) {
          openBrowser(url);
        }
      })
      .catch(() => {
        console.error(
          `Port ${PORT} is already in use. Stop the other server or choose a different PORT.`,
        );
        process.exitCode = 1;
      });
  });

  server.listen(PORT, HOST, () => {
    console.log(`AniList catalog server listening at ${url}`);
    if (process.argv.includes('--open')) {
      openBrowser(url);
    }
  });
}

module.exports = { fetchCatalog, getCatalog, server };
