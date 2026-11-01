'use strict';

(() => {
const grid = document.querySelector('#all-manga-grid');
const count = document.querySelector('#all-manga-count');
const status = document.querySelector('#all-manga-status');
const loadMoreButton = document.querySelector('#load-more-manga');
const searchInput = document.querySelector('#all-manga-search');
const menuToggle = document.querySelector('.menu-toggle');
const siteMenu = document.querySelector('#site-menu');
const pageHeading = document.querySelector('.all-manga-heading h1');
const pageDescription = document.querySelector('.all-manga-heading > p:not(.all-manga-eyebrow, .all-manga-count)');
const initialSearch = new URLSearchParams(window.location.search).get('search')?.trim() || '';
let nextPage = 1;
let totalManga = 0;
let hasNextPage = true;
let isLoading = false;
let isSearchResultsPage = false;
let menuPreviousBodyOverflow = '';
let menuCloseTimer;

function createMangaCard(manga) {
  const card = document.createElement('article');
  card.className = 'anime-card row_item all-manga-card';
  card.dataset.anilistId = manga.id;
  card.dataset.mangaTitle = manga.title;
  card.dataset.mangaCover = manga.coverUrl || '';
  card.dataset.mangaUrl = manga.url;

  const poster = document.createElement('div');
  poster.className = 'poster-container';
  const link = document.createElement('a');
  link.className = 'poster-link';
  link.href = `reader.html?manga=${encodeURIComponent(manga.id)}`;
  link.setAttribute('aria-label', `Find chapters for ${manga.title}`);

  const image = document.createElement('img');
  image.className = 'poster-image';
  image.src = manga.coverUrl || 'Assets/logo.png';
  image.alt = `${manga.title} cover`;
  image.loading = 'lazy';
  image.decoding = 'async';
  link.append(image);
  poster.append(link);

  const overlay = document.createElement('div');
  overlay.className = 'info-overlay';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = manga.latestChapter?.chapter
    ? `${manga.latestChapter.chapter} CHAPTERS`
    : (manga.status || 'MANGA').replaceAll('_', ' ');
  overlay.append(badge);
  poster.append(overlay);

  const title = document.createElement('h2');
  title.className = 'card-title';
  const titleLink = document.createElement('a');
  titleLink.href = link.href;
  titleLink.textContent = manga.title;
  title.append(titleLink);

  card.append(poster, title);
  return card;
}

function updateCount() {
  if (isSearchResultsPage) {
    const resultCount = grid.children.length;
    count.textContent = `${resultCount.toLocaleString()} result${resultCount === 1 ? '' : 's'} for "${initialSearch}"`;
    status.textContent = resultCount ? '' : `No manga found for "${initialSearch}". Try a different title.`;
    return;
  }

  count.textContent = `Loaded ${grid.children.length.toLocaleString()} of ${totalManga.toLocaleString()} manga`;
  status.textContent = '';
}

async function loadMangaPage() {
  if (isLoading || !hasNextPage) {
    return;
  }

  isLoading = true;
  loadMoreButton.disabled = true;
  loadMoreButton.textContent = 'Loading…';
  loadMoreButton.hidden = false;
  status.textContent = `Loading page ${nextPage} from AniList…`;

  try {
    const response = await fetch(`/api/manga/all?page=${nextPage}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `AniList request failed (${response.status}).`);
    }
    if (!Array.isArray(payload.row_item) || !payload.pageInfo) {
      throw new Error('AniList returned an invalid manga page.');
    }

    totalManga = payload.pageInfo.total;
    hasNextPage = payload.pageInfo.hasNextPage;
    nextPage = payload.pageInfo.currentPage + 1;
    grid.append(...payload.row_item.map(createMangaCard));
    updateCount();
    loadMoreButton.hidden = !hasNextPage;
    loadMoreButton.textContent = 'Load more manga';
  } catch (error) {
    console.error('Unable to load AniList manga:', error);
    status.textContent = error.message || 'Manga could not be loaded. Please try again.';
    loadMoreButton.hidden = false;
    loadMoreButton.textContent = 'Retry';
  } finally {
    isLoading = false;
    loadMoreButton.disabled = false;
  }
}

async function loadSearchResults(query) {
  isSearchResultsPage = true;
  searchInput.value = query;
  pageHeading.textContent = 'Search Results';
  pageDescription.textContent = `Manga matching "${query}" from AniList.`;
  loadMoreButton.hidden = true;
  count.textContent = `Searching AniList for "${query}"…`;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `AniList search failed (${response.status}).`);
    }
    if (!Array.isArray(payload.results)) {
      throw new Error('AniList returned invalid manga search results.');
    }

    grid.replaceChildren(...payload.results.map(createMangaCard));
    updateCount();
  } catch (error) {
    console.error('Unable to search AniList manga:', error);
    count.textContent = '';
    status.textContent = error.message || 'Manga search is unavailable. Please try again.';
  }
}

function openSiteMenu() {
  clearTimeout(menuCloseTimer);
  siteMenu.hidden = false;
  siteMenu.setAttribute('aria-hidden', 'false');
  menuToggle.setAttribute('aria-expanded', 'true');
  menuToggle.setAttribute('aria-label', 'Close menu');
  menuPreviousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    if (!siteMenu.hidden) {
      siteMenu.classList.add('active');
      siteMenu.querySelector('.nav-drawer-close').focus();
    }
  });
}

function closeSiteMenu({ restoreFocus = true } = {}) {
  if (siteMenu.hidden) {
    return;
  }
  siteMenu.classList.remove('active');
  siteMenu.setAttribute('aria-hidden', 'true');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open menu');
  document.body.style.overflow = menuPreviousBodyOverflow;
  if (restoreFocus) {
    menuToggle.focus();
  }
  clearTimeout(menuCloseTimer);
  menuCloseTimer = window.setTimeout(() => {
    if (!siteMenu.classList.contains('active')) {
      siteMenu.hidden = true;
    }
  }, 260);
}

loadMoreButton.addEventListener('click', loadMangaPage);
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const query = searchInput.value.trim();
    const destination = query
      ? `all-manga.html?search=${encodeURIComponent(query)}`
      : 'all-manga.html';
    window.location.href = destination;
  }
});
menuToggle.addEventListener('click', () => {
  if (siteMenu.hidden) {
    openSiteMenu();
  } else {
    closeSiteMenu({ restoreFocus: false });
  }
});
siteMenu.querySelector('.nav-drawer-close').addEventListener('click', () => closeSiteMenu());
siteMenu.addEventListener('click', (event) => {
  if (event.target === siteMenu) {
    closeSiteMenu();
  } else if (event.target.closest('.nav-drawer-search')) {
    closeSiteMenu({ restoreFocus: false });
    searchInput.focus();
  } else if (event.target.closest('a')) {
    closeSiteMenu({ restoreFocus: false });
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !siteMenu.hidden) {
    closeSiteMenu();
  }
});

if (initialSearch.length >= 2) {
  loadSearchResults(initialSearch);
} else {
  loadMangaPage();
}
})();
