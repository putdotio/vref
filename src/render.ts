import type { VrefManifest, VrefScreenshot } from "./types.js";

type ScreenshotOrientation = "landscape" | "portrait" | "square";

type GalleryViewModel = {
  manifest: VrefManifest;
  manifestLabel: string;
  groups: string[];
  platforms: string[];
  devices: string[];
  tags: string[];
};

export type RenderGalleryOptions = {
  manifestLabel?: string;
};

export function renderGallery(manifest: VrefManifest, options: RenderGalleryOptions = {}): string {
  const viewModel = makeViewModel(manifest, options);

  return `<!DOCTYPE html>
<html lang="en">
${renderHead(viewModel)}
${renderBody(viewModel)}
</html>
`;
}

function makeViewModel(manifest: VrefManifest, options: RenderGalleryOptions): GalleryViewModel {
  return {
    manifest,
    manifestLabel: options.manifestLabel ?? ".vref/manifest.json",
    groups: uniqueSorted(manifest.screenshots.map((screenshot) => screenshot.group)),
    platforms: uniqueSorted(manifest.screenshots.map((screenshot) => screenshot.platform)),
    devices: uniqueSorted(manifest.screenshots.map((screenshot) => screenshot.device)),
    tags: repeatedSortedTags(manifest.screenshots),
  };
}

function renderHead(viewModel: GalleryViewModel): string {
  return `<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#09090B">
<title>${escapeHtml(viewModel.manifest.title)}</title>
<style>
${renderStyles(viewModel)}
</style>
</head>`;
}

function renderBody(viewModel: GalleryViewModel): string {
  return `<body>
<div class="container">
${renderHero(viewModel)}
${renderFilters(viewModel)}
${renderGalleryGrid(viewModel)}
  <div class="footer">Generated from <code>${escapeHtml(viewModel.manifestLabel)}</code> with <code>vref build</code></div>
</div>

${renderModal()}
<script>
${renderClientScript()}
</script>
</body>`;
}

function renderHero(viewModel: GalleryViewModel): string {
  const { manifest } = viewModel;
  const subtitle = renderHeroSubtitle(viewModel);

  return `  <div class="hero">
    <h1>${renderPutioTitle(manifest.title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
  </div>`;
}

function renderHeroSubtitle(viewModel: GalleryViewModel): string {
  const referenceCount = viewModel.manifest.screenshots.length;
  const referenceLabel = referenceCount === 1 ? "reference" : "references";
  const platformLabel = viewModel.platforms.length === 1 ? `${viewModel.platforms[0]} ` : "";

  return `${referenceCount} curated ${platformLabel}${referenceLabel} for quick visual review.`;
}

function renderFilters(viewModel: GalleryViewModel): string {
  const rows = [
    renderFilterRow("Platform", "platform", viewModel.platforms),
    renderFilterRow("Group", "group", viewModel.groups),
    renderFilterRow("Tag", "tag", viewModel.tags),
  ].filter((row) => row.length > 0);

  if (rows.length === 0) {
    return "";
  }

  return `  <div class="filters">
${rows.join("\n")}
  </div>`;
}

function renderFilterRow(label: string, group: string, labels: string[]): string {
  if (labels.length <= 1) {
    return "";
  }

  return `    <div class="filter-row">
      <span class="filter-label">${escapeHtml(label)}</span>
      <div class="filter-group">${renderFilterButtons(group, labels)}</div>
    </div>`;
}

function renderGalleryGrid(viewModel: GalleryViewModel): string {
  const { manifest } = viewModel;
  const cards = manifest.screenshots.map(renderCard).join("\n    ");
  const referenceCount = manifest.screenshots.length;
  const referenceLabel = referenceCount === 1 ? "reference" : "references";

  return `  <div class="results-count">${referenceCount} ${referenceLabel} &middot; Updated ${escapeHtml(formatUpdatedAt(manifest.updatedAt))}</div>
  <div class="grid" id="gallery">
    ${cards}
  </div>`;
}

function renderModal(): string {
  return `<div class="modal-overlay" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-hidden="true">
  <div class="modal-panel">
    <div class="modal-header">
      <div class="modal-title" id="modal-title"></div>
      <a class="modal-btn" id="modal-open" href="">Open image</a>
      <button class="modal-btn" id="modal-close" type="button">Close</button>
    </div>
    <div class="modal-frame"><img id="modal-image" src="" alt=""></div>
  </div>
</div>`;
}

function renderFilterButtons(group: string, labels: string[]): string {
  return ["All", ...labels]
    .map((label, index) => {
      const value = index === 0 ? "all" : filterValue(label);
      const id = filterInputId(group, value);
      const checked = index === 0 ? " checked" : "";

      return `<label class="nav-btn" data-filter-group="${escapeHtml(group)}" data-filter-value="${escapeHtml(value)}"><input class="filter-control" type="radio" name="filter-${escapeHtml(group)}" id="${escapeHtml(id)}"${checked}><span>${escapeHtml(label)}</span></label>`;
    })
    .join("");
}

function repeatedSortedTags(screenshots: VrefScreenshot[]): string[] {
  const counts = new Map<string, number>();

  for (const screenshot of screenshots) {
    for (const tag of screenshot.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return uniqueSorted(
    [...counts.entries()].filter((entry) => entry[1] > 1).map((entry) => entry[0]),
  );
}

function renderCard(screenshot: VrefScreenshot): string {
  const tagList = screenshot.tags.map(filterValue).join(" ");
  const visibleTagsHtml =
    screenshot.tags.length > 1
      ? `<div class="item-tags">${screenshot.tags
          .slice(0, 3)
          .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
          .join("")}</div>`
      : "";
  const metadata = `${screenshot.viewport.width}x${screenshot.viewport.height} / ${formatBytes(screenshot.sizeBytes)}`;
  const platformValue = filterValue(screenshot.platform);
  const orientation = screenshotOrientation(screenshot);

  return `<a class="card" href="${escapeHtml(screenshot.file)}" aria-label="${escapeHtml(screenshot.title)} screenshot" data-card data-title="${escapeHtml(screenshot.title)}" data-platform="${escapeHtml(platformValue)}" data-group="${escapeHtml(filterValue(screenshot.group))}" data-tags="${escapeHtml(tagList)}" data-orientation="${orientation}">
      <img class="preview" src="${escapeHtml(screenshot.file)}" alt="" loading="lazy">
      <div class="card-body">
        <div class="item-info">
          <div class="item-name">${escapeHtml(screenshot.title)}</div>
          <div class="item-meta"><span>${escapeHtml(screenshot.group)}</span><span>${escapeHtml(metadata)}</span></div>
          ${visibleTagsHtml}
        </div>
      </div>
    </a>`;
}

function renderStyles(viewModel: GalleryViewModel): string {
  return `  @import url('https://static.put.io/fonts/gt-america/standard/font.css');
  @import url('https://static.put.io/fonts/gt-america/mono/font.css');
  @import url('https://static.put.io/fonts/gt-america/extended/font.css');
  @import url('https://static.put.io/fonts/berkeley-mono/variable/font.css');

  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #09090B;
    --bg-2: #111113;
    --bg-3: #19191B;
    --bg-4: #222225;
    --line: #27272A;
    --border: #3F3F46;
    --solid: #71717A;
    --text-2: #A1A1AA;
    --text: #FAFAFA;
    --yellow: #FDCE45;
    --blue: #60A5FA;
    --green: #34D399;
    --pink: #F472B6;
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  }
  body {
    font-family: 'GT America', -apple-system, system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
    line-height: 1.5;
  }
  button, a { -webkit-tap-highlight-color: transparent; }
  button { font: inherit; }
  .container {
    max-width: 1120px;
    min-height: 100dvh;
    margin: 0 auto;
    padding: 56px 24px 44px;
    display: flex;
    flex-direction: column;
  }
  .hero { margin-bottom: 30px; }
  .hero h1 { font-size: 30px; font-weight: 600; letter-spacing: 0; margin-bottom: 0; }
  .hero h1 span { color: var(--yellow); }
  .hero p {
    max-width: 520px;
    margin: 6px 0 0;
    color: var(--text-2);
    font-size: 16px;
    line-height: 1.5;
  }
  .filter-control {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .filters {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--bg);
    padding: 10px 0 16px;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    margin-bottom: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .filter-row { display: flex; gap: 7px; align-items: center; overflow-x: auto; scrollbar-width: none; }
  .filter-row::-webkit-scrollbar { display: none; }
  .filter-label {
    font-size: 10px;
    color: var(--solid);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    width: 60px;
    flex: 0 0 auto;
  }
  .filter-group { display: flex; gap: 4px; align-items: center; }
  .nav-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    background: rgba(255,255,255,0.025);
    border: none;
    border-radius: 5px;
    padding: 2px 7px;
    font-size: 11px;
    color: rgba(250,250,250,0.58);
    cursor: pointer;
    white-space: nowrap;
    min-height: 24px;
    transition: transform 140ms var(--ease-out);
  }
  .nav-btn span { pointer-events: none; }
  .nav-btn:active { transform: scale(0.97); }
  .nav-btn:has(.filter-control:focus-visible), .modal-btn:focus-visible, .card:focus-visible {
    outline: 2px solid var(--yellow);
    outline-offset: 3px;
  }
  .nav-btn:has(.filter-control:checked) { color: #15130A; background: var(--yellow); font-weight: 600; }
${renderFilterStateCss(viewModel)}
  .results-count {
    font-size: 11px;
    color: var(--solid);
    margin-bottom: 16px;
    font-family: 'Berkeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); align-items: start; gap: 18px; }
  .card {
    display: block;
    text-decoration: none;
    color: inherit;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
    transition: transform 160ms var(--ease-out);
  }
  .card:active { transform: scale(0.995); }
  .preview {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    background: #000;
    outline: 1px solid rgba(255,255,255,0.08);
    outline-offset: -1px;
  }
  .card[data-orientation="portrait"] .preview { aspect-ratio: 3 / 4; }
  .card[data-orientation="square"] .preview { aspect-ratio: 1; }
  .card-body { display: flex; align-items: flex-start; gap: 10px; padding: 14px; }
  .item-info { flex: 1; min-width: 0; }
  .item-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-meta {
    font-size: 11px;
    color: var(--solid);
    display: flex;
    gap: 8px;
    align-items: center;
    font-family: 'Berkeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    margin-top: 2px;
  }
  .item-tags {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .tag {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
    font-family: 'Berkeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    background: rgba(253, 206, 69, 0.12);
    border: 1px solid rgba(253, 206, 69, 0.14);
    color: #F8D867;
  }
  .footer {
    text-align: center;
    margin-top: auto;
    padding: 56px 0 0;
    color: var(--solid);
    font-family: 'Berkeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
  }
  .footer code { color: var(--text-2); font: inherit; }
  .modal-overlay {
    display: flex;
    position: fixed;
    inset: 0;
    z-index: 100;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(12px);
    padding: 32px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms var(--ease-out);
  }
  .modal-overlay.open { opacity: 1; pointer-events: auto; }
  .modal-panel {
    width: min(1400px, 100%);
    opacity: 0.96;
    transform: scale(0.98);
    transform-origin: center;
    transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
  }
  .modal-overlay.open .modal-panel { opacity: 1; transform: scale(1); }
  .modal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .modal-title {
    flex: 1;
    min-width: 0;
    color: var(--text-2);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .modal-btn {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 5px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-2);
    cursor: pointer;
    text-decoration: none;
    min-height: 28px;
    transition: transform 140ms var(--ease-out);
  }
  .modal-btn:active { transform: scale(0.97); }
  .modal-frame {
    overflow: hidden;
    background: #000;
    border-radius: 4px;
    border: 10px solid #1A1A1A;
    box-shadow: 0 32px 100px rgba(0,0,0,0.6);
  }
  .modal-frame img { display: block; width: 100%; height: auto; max-height: calc(100vh - 132px); object-fit: contain; }
  @media (hover: hover) and (pointer: fine) {
    .nav-btn:not(:has(.filter-control:checked)):hover { color: var(--text); background: rgba(255,255,255,0.075); }
    .nav-btn:has(.filter-control:checked):hover { background: #FFD85C; }
    .card:hover { border-color: var(--border); background: var(--bg-3); transform: translateY(-1px); box-shadow: 0 18px 44px rgba(0,0,0,0.28); }
    .modal-btn:hover { background: rgba(255,255,255,0.15); color: var(--text); }
  }
  @media (max-width: 720px) {
    .container { padding: 36px 16px 32px; }
    .grid { grid-template-columns: 1fr; }
    .hero { margin-bottom: 28px; }
    .hero h1 { font-size: 28px; }
    .filters { padding: 8px 0 16px; margin-bottom: 14px; }
    .filter-label { width: 54px; }
    .nav-btn { min-height: 34px; padding: 4px 10px; }
    .modal-overlay { padding: 14px; }
    .modal-header { flex-wrap: wrap; }
    .modal-title { flex-basis: 100%; }
    .modal-btn { min-height: 34px; padding: 6px 10px; }
    .modal-frame { border-width: 4px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .nav-btn, .card, .modal-overlay, .modal-panel, .modal-btn {
      transition-duration: 0.01ms;
    }
    .nav-btn:active, .card:active, .card:hover, .modal-panel, .modal-overlay.open .modal-panel, .modal-btn:active {
      transform: none;
    }
  }`;
}

function renderFilterStateCss(viewModel: GalleryViewModel): string {
  const visibilityRules = [
    ...filterValues("platform", viewModel.platforms)
      .filter((filter) => filter.value !== "all")
      .map(
        (filter) =>
          `  .container:has(#${filter.id}:checked) #gallery .card:not([data-platform="${filter.value}"]) { display: none; }`,
      ),
    ...filterValues("group", viewModel.groups)
      .filter((filter) => filter.value !== "all")
      .map(
        (filter) =>
          `  .container:has(#${filter.id}:checked) #gallery .card:not([data-group="${filter.value}"]) { display: none; }`,
      ),
    ...filterValues("tag", viewModel.tags)
      .filter((filter) => filter.value !== "all")
      .map(
        (filter) =>
          `  .container:has(#${filter.id}:checked) #gallery .card:not([data-tags~="${filter.value}"]) { display: none; }`,
      ),
  ];

  return visibilityRules.join("\n");
}

function filterValues(group: string, labels: string[]): { id: string; value: string }[] {
  if (labels.length <= 1) {
    return [];
  }

  return ["all", ...labels.map(filterValue)].map((value) => ({
    id: filterInputId(group, value),
    value,
  }));
}

function renderClientScript(): string {
  return `  const cards = Array.from(document.querySelectorAll('[data-card]'));
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalImage = document.getElementById('modal-image');
  const modalOpen = document.getElementById('modal-open');
  const modalClose = document.getElementById('modal-close');
  let lastFocusedElement = null;

  cards.forEach((card) => {
    card.addEventListener('click', (event) => {
      event.preventDefault();
      lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      modalTitle.textContent = card.dataset.title;
      modalImage.src = card.getAttribute('href');
      modalImage.alt = card.dataset.title;
      modalOpen.href = card.getAttribute('href');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      modalClose.focus({ preventScroll: true });
    });
  });

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  function closeModal() {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modalImage.removeAttribute('src');
    if (lastFocusedElement) {
      lastFocusedElement.focus({ preventScroll: true });
      lastFocusedElement = null;
    }
  }`;
}

function renderPutioTitle(title: string): string {
  return escapeHtml(title).replace("put.io", "put<span>.</span>io");
}

function screenshotOrientation(screenshot: VrefScreenshot): ScreenshotOrientation {
  if (screenshot.viewport.width === screenshot.viewport.height) {
    return "square";
  }

  return screenshot.viewport.width > screenshot.viewport.height ? "landscape" : "portrait";
}

function filterInputId(group: string, value: string): string {
  return `filter-${group}-${value}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${Math.round(bytes / 1024)} KB`;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function filterValue(label: string): string {
  // Fixed-width UTF-16 encoding preserves exact labels and keeps them out of CSS markup.
  // The prefix also separates every label (including "All") from the universal sentinel.
  let value = "value-";
  for (let index = 0; index < label.length; index += 1) {
    value += label.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
