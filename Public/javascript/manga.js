'use strict';

const EMPTY_MESSAGES = {
  popular: 'No popular manga is available right now.',
  trending: 'No trending manga is available right now.',
  latest: 'AniList has no recently updated manga for these results.',
  upcoming: 'AniList does not track scheduled manga chapter releases.',
};
const searchInput = document.querySelector('#manga-search, #all-manga-search');
const searchResults = document.querySelector('#search-results');
const menuToggle = document.querySelector('.menu-toggle');
const siteMenu = document.querySelector('#site-menu');
const navContainer = document.querySelector('.nav-container');
const mobileSearchToggle = document.querySelector('.mobile-search-toggle');
const mobileSearchClose = document.querySelector('.mobile-search-close');
const developerModal = document.querySelector('#footerDeveloperModal');
const developerModalCard = developerModal?.querySelector('.developer-modal-card');
const developerModalClose = document.querySelector('#closeDeveloperModal');
const developerModalTriggers = document.querySelectorAll(
  '#footerDeveloperImageTrigger, #footerDeveloperChip',
);
let searchTimer;
let searchRequest;
let searchSequence = 0;
let catalogManga = [];
let developerModalTrigger;
let previousBodyOverflow;
let menuPreviousBodyOverflow;
let menuCloseTimer;

function openDeveloperModal(trigger) {
  developerModalTrigger = trigger;
  previousBodyOverflow = document.body.style.overflow;
  developerModal.hidden = false;
  developerModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    developerModal.classList.add('active');
    developerModalCard.focus();
  });
}

function closeDeveloperModal() {
  developerModal.classList.remove('active');
  developerModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = previousBodyOverflow;
  developerModalTrigger?.focus();
  window.setTimeout(() => {
    if (!developerModal.classList.contains('active')) {
      developerModal.hidden = true;
    }
  }, 180);
}

developerModalTriggers.forEach((trigger) => {
  trigger.addEventListener('click', () => openDeveloperModal(trigger));
});
developerModalClose?.addEventListener('click', closeDeveloperModal);
developerModal?.addEventListener('click', (event) => {
  if (event.target === developerModal) {
    closeDeveloperModal();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && developerModal && !developerModal.hidden) {
    closeDeveloperModal();
  }
});

document.querySelector('.footer-col a[href="#manga-search"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  searchInput.focus();
});

function formatMangaDescription(description) {
  const withLineBreaks = description
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n');
  const parsed = new DOMParser().parseFromString(withLineBreaks, 'text/html');
  return parsed.body.textContent.trim();
}

function closeSearch() {
  if (!searchResults || !searchInput) {
    return;
  }
  searchResults.hidden = true;
  searchInput.setAttribute('aria-expanded', 'false');
}

function closeMobileSearch() {
  navContainer?.classList.remove('mobile-search-open');
  mobileSearchToggle?.setAttribute('aria-expanded', 'false');
  mobileSearchToggle?.setAttribute('aria-label', 'Open search');
  closeSearch();
}

mobileSearchToggle?.addEventListener('click', () => {
  const isOpening = !navContainer.classList.contains('mobile-search-open');
  navContainer.classList.toggle('mobile-search-open', isOpening);
  mobileSearchToggle.setAttribute('aria-expanded', String(isOpening));
  mobileSearchToggle.setAttribute('aria-label', isOpening ? 'Close search' : 'Open search');
  if (isOpening) {
    searchInput?.focus();
  } else {
    closeSearch();
  }
});

mobileSearchClose?.addEventListener('click', () => {
  closeMobileSearch();
  mobileSearchToggle?.focus();
});

function openSiteMenu() {
  clearTimeout(menuCloseTimer);
  siteMenu.hidden = false;
  siteMenu.setAttribute('aria-hidden', 'false');
  menuToggle.setAttribute('aria-expanded', 'true');
  menuToggle.setAttribute('aria-label', 'Close menu');
  menuPreviousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    if (siteMenu.hidden) {
      return;
    }
    siteMenu.classList.add('active');
    siteMenu.querySelector('.nav-drawer-close').focus();
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

function showSearchMessage(message) {
  const item = document.createElement('p');
  item.className = 'search-message';
  item.textContent = message;
  searchResults.replaceChildren(item);
  searchResults.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

function createSearchResult(manga) {
  const result = document.createElement('button');
  result.type = 'button';
  result.className = 'search-result';
  result.setAttribute('role', 'option');
  result.addEventListener('click', () => {
    window.location.href = `reader.html?manga=${encodeURIComponent(manga.id)}`;
  });

  const cover = document.createElement('img');
  cover.src = manga.coverUrl || 'Assets/logo.png';
  cover.alt = '';
  cover.loading = 'lazy';
  result.append(cover);

  const copy = document.createElement('span');
  copy.className = 'search-result-copy';
  const title = document.createElement('span');
  title.className = 'search-result-title';
  title.textContent = manga.title;
  const detail = document.createElement('span');
  detail.className = 'search-result-meta';
  const chapterCount = manga.latestChapter?.chapter;
  detail.textContent = [
    manga.status?.replaceAll('_', ' ').toLowerCase(),
    chapterCount ? `${chapterCount} chapters listed` : '',
  ].filter(Boolean).join(' · ');
  copy.append(title, detail);
  result.append(copy);
  return result;
}

async function searchManga(query) {
  const sequence = ++searchSequence;
  searchRequest?.abort();
  searchRequest = new AbortController();
  showSearchMessage('Searching AniList…');

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      signal: searchRequest.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Manga search failed (${response.status}).`);
    }
    if (sequence !== searchSequence) {
      return;
    }

    if (!Array.isArray(payload.results) || payload.results.length === 0) {
      showSearchMessage('No manga titles found.');
      return;
    }

    searchResults.replaceChildren(...payload.results.map(createSearchResult));
    searchResults.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  } catch (error) {
    if (error.name === 'AbortError' || sequence !== searchSequence) {
      return;
    }
    console.error('Unable to search manga:', error);
    showSearchMessage(error.message || 'Manga search is unavailable right now.');
  }
}

function setTrackMessage(track, message) {
  const item = document.createElement('p');
  item.className = 'row_message';
  item.textContent = message;
  track.replaceChildren(item);
}

function getMangaModal() {
  let overlay = document.querySelector('#manga-details-modal');
  if (overlay) {
    return overlay;
  }

  overlay = document.createElement('div');
  overlay.id = 'manga-details-modal';
  overlay.className = 'manga-modal-overlay';
  overlay.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('section');
  dialog.className = 'manga-modal-card';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'manga-modal-title');
  dialog.tabIndex = -1;

  const closeButton = document.createElement('button');
  closeButton.className = 'manga-modal-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close manga details');
  closeButton.textContent = '×';

  const banner = document.createElement('div');
  banner.className = 'manga-modal-banner';
  banner.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'manga-modal-body';
  const poster = document.createElement('img');
  poster.className = 'manga-modal-poster';
  poster.alt = '';

  const details = document.createElement('div');
  details.className = 'manga-modal-details';
  const title = document.createElement('h2');
  title.className = 'manga-modal-title';
  title.id = 'manga-modal-title';
  const nativeTitle = document.createElement('p');
  nativeTitle.className = 'manga-modal-native-title';
  const meta = document.createElement('div');
  meta.className = 'manga-modal-meta';
  const genres = document.createElement('div');
  genres.className = 'manga-modal-genres';
  const description = document.createElement('p');
  description.className = 'manga-modal-description';
  const chapterSection = document.createElement('section');
  chapterSection.className = 'manga-modal-chapters';
  const chapterHeading = document.createElement('h3');
  chapterHeading.className = 'manga-modal-chapters-heading';
  chapterHeading.textContent = 'Chapters';
  const chapterStatus = document.createElement('p');
  chapterStatus.className = 'manga-modal-chapters-status';
  chapterStatus.setAttribute('role', 'status');
  chapterStatus.setAttribute('aria-live', 'polite');
  chapterStatus.textContent = 'Loading available chapter links…';
  const chapterList = document.createElement('div');
  chapterList.className = 'manga-modal-chapter-list';
  chapterList.setAttribute('aria-label', 'Available chapters');
  chapterSection.append(chapterHeading, chapterStatus, chapterList);
  const characterSection = document.createElement('section');
  characterSection.className = 'manga-modal-section manga-modal-character-section';
  const characterHeading = document.createElement('h3');
  characterHeading.className = 'manga-modal-section-heading';
  characterHeading.textContent = 'Main Characters';
  const characterStatus = document.createElement('p');
  characterStatus.className = 'manga-modal-section-status';
  const characterList = document.createElement('div');
  characterList.className = 'manga-modal-character-list';
  characterSection.append(characterHeading, characterStatus, characterList);
  const recommendationSection = document.createElement('section');
  recommendationSection.className = 'manga-modal-section manga-modal-recommendation-section';
  const recommendationHeading = document.createElement('h3');
  recommendationHeading.className = 'manga-modal-section-heading';
  recommendationHeading.textContent = 'You Might Also Like';
  const recommendationStatus = document.createElement('p');
  recommendationStatus.className = 'manga-modal-section-status';
  const recommendationList = document.createElement('div');
  recommendationList.className = 'manga-modal-recommendation-list';
  recommendationSection.append(recommendationHeading, recommendationStatus, recommendationList);
  const actions = document.createElement('div');
  actions.className = 'manga-modal-actions';
  const readLink = document.createElement('a');
  readLink.className = 'manga-modal-button manga-modal-read';
  readLink.textContent = 'Start Reading';
  readLink.href = '#';
  readLink.setAttribute('aria-disabled', 'true');

  actions.append(readLink);
  details.append(title, nativeTitle, meta, genres, description, chapterSection, actions);
  body.append(poster, details);
  dialog.append(closeButton, banner, body, characterSection, recommendationSection);
  overlay.append(dialog);
  document.body.append(overlay);

  let lastTrigger;
  let requestSequence = 0;
  const close = () => {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    lastTrigger?.focus();
  };
  readLink.addEventListener('click', (event) => {
    if (readLink.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
    }
  });
  closeButton.addEventListener('click', close);
  recommendationList.addEventListener('click', (event) => {
    const recommendation = event.target.closest('.manga-modal-recommendation');
    if (!recommendation) {
      return;
    }
    overlay.openManga({
      id: recommendation.dataset.anilistId,
      title: recommendation.dataset.mangaTitle,
      coverUrl: recommendation.dataset.mangaCover,
      url: recommendation.dataset.mangaUrl,
    }, recommendation);
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('active')) {
      close();
    }
  });

  overlay.openManga = async (manga, trigger) => {
    const sequence = ++requestSequence;
    let anilistChapterCount = null;
    if (!overlay.classList.contains('active') || !lastTrigger?.isConnected) {
      lastTrigger = trigger;
    }
    title.textContent = manga.title;
    nativeTitle.textContent = '';
    meta.textContent = 'Loading manga details…';
    genres.replaceChildren();
    description.textContent = '';
    chapterHeading.textContent = 'Chapters';
    chapterStatus.textContent = 'Loading available chapter links…';
    chapterList.replaceChildren();
    readLink.href = `reader.html?manga=${encodeURIComponent(manga.id)}`;
    readLink.removeAttribute('aria-disabled');
    readLink.removeAttribute('aria-label');
    characterStatus.textContent = 'Loading characters…';
    characterList.replaceChildren();
    recommendationStatus.textContent = 'Loading recommendations…';
    recommendationList.replaceChildren();
    poster.src = manga.coverUrl || 'Assets/logo.png';
    banner.style.backgroundImage = manga.coverUrl ? `url("${manga.coverUrl}")` : '';
    readLink.href = `reader.html?manga=${encodeURIComponent(manga.id)}`;
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    dialog.scrollTop = 0;
    dialog.focus();

    try {
      const response = await fetch(`/api/anilist-manga/${encodeURIComponent(manga.id)}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || `Manga details request failed (${response.status}).`);
      }
      if (sequence !== requestSequence || !payload.manga) {
        return;
      }

      const detailsData = payload.manga;
      anilistChapterCount = Number.isInteger(detailsData.chapters) ? detailsData.chapters : null;
      title.textContent = detailsData.title || manga.title;
      nativeTitle.textContent = detailsData.nativeTitle || '';
      chapterHeading.textContent = anilistChapterCount === null
        ? 'Chapters'
        : `Chapters (${anilistChapterCount})`;
      const metaItems = [
        detailsData.format,
        detailsData.year,
        detailsData.status?.replaceAll('_', ' '),
        anilistChapterCount === null ? null : `${anilistChapterCount} AniList chapters`,
        Number.isInteger(detailsData.volumes) ? `${detailsData.volumes} volumes` : null,
        detailsData.score ? `★ ${(detailsData.score / 10).toFixed(1)}` : null,
      ].filter(Boolean);
      meta.textContent = metaItems.join(' · ') || 'Manga details';
      genres.replaceChildren(...detailsData.genres.map((genre) => {
        const tag = document.createElement('span');
        tag.className = 'manga-modal-genre';
        tag.textContent = genre;
        return tag;
      }));
      description.textContent = detailsData.description
        ? formatMangaDescription(detailsData.description)
        : 'No synopsis is available for this manga.';
      poster.src = detailsData.coverUrl || manga.coverUrl || 'Assets/logo.png';
      banner.style.backgroundImage = detailsData.coverUrl || manga.coverUrl
        ? `url("${detailsData.coverUrl || manga.coverUrl}")`
        : '';
      const characters = Array.isArray(detailsData.characters) ? detailsData.characters : [];
      characterStatus.textContent = characters.length
        ? ''
        : 'No character information is available for this manga.';
      characterList.replaceChildren(...characters.map((character) => {
        const card = document.createElement('article');
        card.className = 'manga-modal-character';
        const image = document.createElement('img');
        image.className = 'manga-modal-character-image';
        image.src = character.imageUrl || 'Assets/logo.png';
        image.alt = '';
        image.loading = 'lazy';
        const name = document.createElement('span');
        name.className = 'manga-modal-character-name';
        name.textContent = character.name;
        card.append(image, name);
        return card;
      }));

      const recommendations = Array.isArray(detailsData.recommendations)
        ? detailsData.recommendations
        : [];
      recommendationStatus.textContent = recommendations.length
        ? ''
        : 'No manga recommendations are available.';
      recommendationList.replaceChildren(...recommendations.map((recommended) => {
        const card = document.createElement('button');
        card.className = 'manga-modal-recommendation';
        card.type = 'button';
        card.dataset.anilistId = recommended.id;
        card.dataset.mangaTitle = recommended.title;
        card.dataset.mangaCover = recommended.coverUrl || '';
        card.dataset.mangaUrl = recommended.siteUrl;
        const image = document.createElement('img');
        image.className = 'manga-modal-recommendation-cover';
        image.src = recommended.coverUrl || 'Assets/logo.png';
        image.alt = '';
        image.loading = 'lazy';
        const name = document.createElement('span');
        name.className = 'manga-modal-recommendation-title';
        name.textContent = recommended.title;
        card.append(image, name);
        return card;
      }));
    } catch (error) {
      if (sequence !== requestSequence) {
        return;
      }
      console.error('Unable to load manga details:', error);
      meta.textContent = 'Manga details are temporarily unavailable.';
      description.textContent = error.message || 'Try again in a moment.';
      characterStatus.textContent = 'Character information is temporarily unavailable.';
      recommendationStatus.textContent = 'Manga recommendations are temporarily unavailable.';
    }

    try {
      const response = await fetch(`/api/anilist-manga/${encodeURIComponent(manga.id)}/chapters`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || `Chapter list request failed (${response.status}).`);
      }
      if (sequence !== requestSequence) {
        return;
      }
      if (!Array.isArray(payload.chapters)) {
        throw new Error('The chapter list response is incomplete.');
      }

      const chapters = [...payload.chapters].sort((first, second) => {
        const firstNumber = Number.parseFloat(first.chapter);
        const secondNumber = Number.parseFloat(second.chapter);
        const firstHasNumber = Number.isFinite(firstNumber);
        const secondHasNumber = Number.isFinite(secondNumber);
        if (firstHasNumber && secondHasNumber) {
          return firstNumber - secondNumber;
        }
        if (firstHasNumber !== secondHasNumber) {
          return firstHasNumber ? -1 : 1;
        }
        return String(first.chapter || '').localeCompare(String(second.chapter || ''));
      });

      if (chapters.length === 0) {
        chapterStatus.textContent = anilistChapterCount === null
          ? 'No chapters are currently listed on MangaDex.'
          : `AniList lists ${anilistChapterCount} chapters; none are currently listed on MangaDex.`;
        return;
      }

      chapterStatus.textContent = anilistChapterCount === null
        ? `${chapters.length} chapters are listed on MangaDex. Choose one to start reading.`
        : `AniList lists ${anilistChapterCount} chapters; ${chapters.length} chapter links are available on MangaDex. Choose one to read.`;
      chapterList.replaceChildren(...chapters.map((chapter) => {
        const link = document.createElement('a');
        link.className = 'manga-modal-chapter';
        link.href = `reader.html?chapter=${encodeURIComponent(chapter.id)}`;
        const number = chapter.chapter ? `Chapter ${chapter.chapter}` : 'Chapter';
        link.textContent = chapter.title ? `${number}: ${chapter.title}` : number;
        link.setAttribute('aria-label', `Read ${link.textContent}`);
        return link;
      }));
    } catch (error) {
      if (sequence !== requestSequence) {
        return;
      }
      console.error('Unable to load manga chapters:', error);
      chapterStatus.textContent = anilistChapterCount === null
        ? error.message || 'MangaDex chapters are temporarily unavailable.'
        : `AniList lists ${anilistChapterCount} chapters, but MangaDex chapter links are unavailable: ${error.message || 'request failed'}`;
    }
  };

  return overlay;
}

function createRowItem(manga, trackKey) {
  const item = document.createElement('article');
  item.className = 'anime-card row_item';
  item.dataset.anilistId = manga.id;
  item.dataset.mangaTitle = manga.title;
  item.dataset.mangaCover = manga.coverUrl || '';
  item.dataset.mangaUrl = manga.url;
  const chapter = trackKey === 'upcoming' ? manga.upcomingChapter : manga.latestChapter;
  const mangaReaderHref = `reader.html?manga=${encodeURIComponent(manga.id)}`;
  const chapterHref = trackKey !== 'upcoming'
    ? mangaReaderHref
    : chapter?.url || manga.url;
  const titleHref = trackKey !== 'upcoming' ? mangaReaderHref : manga.url;

  const poster = document.createElement('div');
  poster.className = 'poster-container';
  const posterLink = document.createElement('a');
  posterLink.className = 'poster-link';
  posterLink.href = titleHref;
  posterLink.setAttribute('aria-label', manga.title);

  const cover = document.createElement('img');
  cover.className = 'poster-image';
  cover.src = manga.coverUrl || 'Assets/logo.png';
  cover.alt = `${manga.title} cover`;
  cover.width = 300;
  cover.height = 450;
  cover.loading = 'lazy';
  cover.decoding = 'async';
  cover.addEventListener('error', () => {
    cover.src = 'Assets/logo.png';
  }, { once: true });
  posterLink.append(cover);
  poster.append(posterLink);

  if (chapter) {
    const overlay = document.createElement('div');
    overlay.className = 'info-overlay';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = chapter.badge || (trackKey === 'upcoming'
      ? 'UPCOMING'
      : chapter.chapter
        ? `CH. ${chapter.chapter}`
        : 'LATEST');
    overlay.append(badge);
    poster.append(overlay);
  }

  item.append(poster);
  const title = document.createElement('h3');
  title.className = 'card-title';
  const titleLink = document.createElement('a');
  titleLink.href = titleHref;
  titleLink.textContent = manga.title;
  title.append(titleLink);
  item.append(title);

  if (chapter) {
    const chapterLink = document.createElement('a');
    chapterLink.className = 'chapter-link';
    chapterLink.href = chapterHref;
    const chapterLabel = chapter.label
      || (chapter.chapter ? `Chapter ${chapter.chapter}` : 'Latest chapter');
    chapterLink.textContent = chapter.title ? `${chapterLabel} · ${chapter.title}` : chapterLabel;
    item.append(chapterLink);
  }

  return item;
}

function renderCatalog(payload) {
  if (!Array.isArray(payload.row_track)) {
    throw new Error('The manga API returned an invalid row_track payload.');
  }

  for (const row of payload.row_track) {
    if (row.key === 'popular' && Array.isArray(row.row_item)) {
      catalogManga = row.row_item;
    }
    const track = document.querySelector(`[data-row-track="${row.key}"]`);
    if (!track) {
      continue;
    }

    if (!Array.isArray(row.row_item) || row.row_item.length === 0) {
      setTrackMessage(track, EMPTY_MESSAGES[row.key] || 'No manga items are available.');
      continue;
    }

    track.replaceChildren(...row.row_item.map((manga) => createRowItem(manga, row.key)));
  }
}

async function loadCatalog() {
  const tracks = document.querySelectorAll('[data-row-track]');
  try {
    if (window.location.protocol === 'file:') {
      throw new Error('Open http://127.0.0.1:3000 after starting the server with npm start.');
    }

    const response = await fetch('/api/manga');
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || `Manga API request failed (${response.status}).`);
    }
    renderCatalog(payload);
  } catch (error) {
    console.error('Unable to load manga catalog:', error);
    const message = error.message.includes('127.0.0.1:3000')
      ? error.message
      : 'Manga data could not be loaded. Make sure the server is running with npm start, then open http://127.0.0.1:3000.';
    tracks.forEach((track) => setTrackMessage(track, message));
  }
}

if (searchInput && searchResults) {
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    clearTimeout(searchTimer);
    if (query.length < 2) {
      searchSequence += 1;
      searchRequest?.abort();
      closeSearch();
      return;
    }
    searchTimer = setTimeout(() => searchManga(query), 250);
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSearch();
      searchInput.blur();
    } else if (event.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        window.location.href = `all-manga.html?search=${encodeURIComponent(query)}`;
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      searchResults.querySelector('.search-result')?.focus();
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (searchInput && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if (event.key === 'Escape' && siteMenu && !siteMenu.hidden) {
    closeSiteMenu();
  }
  if (event.key === 'Escape' && navContainer?.classList.contains('mobile-search-open')) {
    closeMobileSearch();
    mobileSearchToggle?.focus();
  }
});

document.addEventListener('click', (event) => {
  if (searchInput && searchResults && !event.target.closest('.nav-search')) {
    closeSearch();
  }
});

if (menuToggle && siteMenu) {
  menuToggle.addEventListener('click', () => {
    if (siteMenu.hidden) {
      openSiteMenu();
    } else {
      closeSiteMenu({ restoreFocus: false });
    }
  });

  siteMenu.querySelector('.nav-drawer-close')?.addEventListener('click', () => {
    closeSiteMenu();
  });

  siteMenu.addEventListener('click', (event) => {
    if (event.target === siteMenu) {
      closeSiteMenu();
      return;
    }
    if (event.target.closest('.nav-drawer-search')) {
      closeSiteMenu({ restoreFocus: false });
      searchInput?.focus();
      return;
    }
    if (event.target.closest('a')) {
      closeSiteMenu({ restoreFocus: false });
    }
  });
}

document.querySelector('.random-manga')?.addEventListener('click', () => {
  if (catalogManga.length === 0) {
    return;
  }
  const manga = catalogManga[Math.floor(Math.random() * catalogManga.length)];
  window.location.href = `reader.html?manga=${encodeURIComponent(manga.id)}`;
});

document.querySelectorAll('.row').forEach((row) => {
  const track = row.querySelector('.row_track');
  row.querySelector('.row_btn--left')?.addEventListener('click', () => {
    track.scrollBy({ left: -track.clientWidth * 0.8, behavior: 'smooth' });
  });
  row.querySelector('.row_btn--right')?.addEventListener('click', () => {
    track.scrollBy({ left: track.clientWidth * 0.8, behavior: 'smooth' });
  });
});

if (document.querySelector('[data-row-track]')) {
  loadCatalog();
}

document.addEventListener('click', (event) => {
  const card = event.target.closest('.anime-card[data-anilist-id]');
  if (!card || event.target.closest('.card-list-toggle')) {
    return;
  }
  event.preventDefault();
  getMangaModal().openManga({
    id: card.dataset.anilistId,
    title: card.dataset.mangaTitle,
    coverUrl: card.dataset.mangaCover,
    url: card.dataset.mangaUrl,
  }, card.querySelector('.poster-link'));
});
