'use strict';

const params = new URLSearchParams(window.location.search);
const chapterId = params.get('chapter');
const aniListMangaId = params.get('manga');
const titleElement = document.querySelector('#reader-title');
const metaElement = document.querySelector('#reader-meta');
const statusElement = document.querySelector('#reader-status');
const pagesElement = document.querySelector('#reader-pages');
const chapterPicker = document.querySelector('#chapter-picker');
const newerButton = document.querySelector('#newer-chapter');
const olderButton = document.querySelector('#older-chapter');
const mangaDexLink = document.querySelector('#open-mangadex');

async function fetchJson(url) {
  const response = await fetch(url);
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    if (!response.ok) {
      throw new Error(
        `Reader API returned HTTP ${response.status} for ${url}: ${responseText.slice(0, 120)}`,
      );
    }
    throw new Error(`Reader API returned an invalid response for ${url}.`);
  }

  if (!response.ok) {
    throw new Error(payload.message || `Request failed (${response.status}).`);
  }
  return payload;
}

function chapterLabel(chapter) {
  const number = chapter.chapter ? `Chapter ${chapter.chapter}` : 'Chapter';
  return chapter.title ? `${number}: ${chapter.title}` : number;
}

function navigateToChapter(id) {
  window.location.href = `reader.html?chapter=${encodeURIComponent(id)}`;
}

function renderChapterPicker(chapters, activeChapterId) {
  chapterPicker.replaceChildren();

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = chapters.length ? 'Choose a chapter…' : 'No chapters found';
  placeholder.disabled = true;
  placeholder.selected = !activeChapterId;
  chapterPicker.append(placeholder);

  chapters.forEach((chapter) => {
    const option = document.createElement('option');
    option.value = chapter.id;
    option.textContent = chapterLabel(chapter);
    option.selected = chapter.id === activeChapterId;
    chapterPicker.append(option);
  });

  chapterPicker.disabled = chapters.length === 0;
  chapterPicker.addEventListener('change', () => navigateToChapter(chapterPicker.value));

  const index = chapters.findIndex((chapter) => chapter.id === activeChapterId);
  newerButton.disabled = index <= 0;
  olderButton.disabled = index < 0 || index >= chapters.length - 1;
  newerButton.onclick = () => {
    if (index > 0) navigateToChapter(chapters[index - 1].id);
  };
  olderButton.onclick = () => {
    if (index >= 0 && index < chapters.length - 1) navigateToChapter(chapters[index + 1].id);
  };
}

async function loadReader() {
  if (chapterId) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(chapterId)) {
      throw new Error('The selected MangaDex chapter ID is invalid.');
    }

    await loadChapter(chapterId);
    return;
  }

  if (aniListMangaId && /^\d+$/.test(aniListMangaId)) {
    await loadMangaChapters(aniListMangaId);
    return;
  }

  throw new Error('Choose a manga from the catalog to find its MangaDex chapters.');
}

async function loadMangaChapters(id) {
  const payload = await fetchJson(`/api/anilist-manga/${encodeURIComponent(id)}/chapters`);
  const { manga, chapters, anilistTitle } = payload;
  if (!manga || !Array.isArray(chapters)) {
    throw new Error('The MangaDex chapter lookup returned incomplete information.');
  }

  document.title = `${anilistTitle} - MangaDex chapters`;
  titleElement.textContent = `${anilistTitle} · Chapters`;
  mangaDexLink.href = manga.url;
  metaElement.textContent = `Matched MangaDex title: ${manga.title}`;
  renderChapterPicker(chapters, null);
  statusElement.textContent = chapters.length
    ? `${chapters.length} English chapters listed on MangaDex. Choose a chapter to read.`
    : 'No English chapters are currently listed for this manga on MangaDex.';
}

async function loadChapter(id) {
  const payload = await fetchJson(`/api/reader/${encodeURIComponent(id)}`);
  const { chapter, manga } = payload;
  if (!chapter || !manga || !Array.isArray(payload.pages)) {
    throw new Error('The reader returned incomplete chapter information.');
  }

  document.title = `${manga.title} - ${chapterLabel(chapter)}`;
  titleElement.textContent = `${manga.title} · ${chapterLabel(chapter)}`;
  mangaDexLink.href = payload.readerUrl || chapter.url;

  const attribution = document.createElement('span');
  if (chapter.group?.name) {
    attribution.append('Scanlation group: ');
    const groupLink = document.createElement('a');
    groupLink.href = chapter.group.url;
    groupLink.target = '_blank';
    groupLink.rel = 'noopener noreferrer';
    groupLink.textContent = chapter.group.name;
    attribution.append(groupLink);
  } else {
    attribution.textContent = 'Scanlation group credit is not listed for this chapter.';
  }

  const readableAt = chapter.readableAt
    ? new Date(chapter.readableAt).toLocaleDateString()
    : '';
  metaElement.replaceChildren(attribution, readableAt ? ` · ${readableAt}` : '');

  const listPayload = await fetchJson(`/api/manga/${encodeURIComponent(manga.id)}/chapters`);
  const chapters = Array.isArray(listPayload.chapters) ? listPayload.chapters : [];
  renderChapterPicker(chapters, chapter.id);

  if (payload.pages.length === 0) {
    statusElement.textContent = chapter.externalUrl
      ? 'This chapter is available from its publisher or external source. Use the source link or open it on MangaDex.'
      : 'MangaDex does not have readable pages for this chapter.';
    if (chapter.externalUrl) {
      const sourceLink = document.createElement('a');
      sourceLink.href = chapter.externalUrl;
      sourceLink.target = '_blank';
      sourceLink.rel = 'noopener noreferrer';
      sourceLink.textContent = ' Open chapter source';
      statusElement.append(sourceLink);
    }
    return;
  }

  statusElement.textContent = `${payload.pages.length} pages · Images and chapter attribution are provided by MangaDex.`;
  payload.pages.forEach((page) => {
    const image = document.createElement('img');
    image.className = 'reader-page';
    image.src = page.url;
    image.alt = `Page ${page.index + 1} of ${payload.pages.length}`;
    image.loading = page.index < 2 ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      image.alt = `Page ${page.index + 1} could not be loaded. Open the chapter on MangaDex.`;
    }, { once: true });
    pagesElement.append(image);
  });
}

loadReader().catch((error) => {
  console.error('Unable to load manga reader:', error);
  titleElement.textContent = 'Reader unavailable';
  statusElement.textContent = error.message || 'The chapter could not be loaded.';
});
