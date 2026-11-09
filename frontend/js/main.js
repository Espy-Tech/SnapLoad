/* ══════════════════════════════════════════
   SnapLoad — JavaScript principal
   Fichier : js/main.js
   ══════════════════════════════════════════ */

/* ── CONFIGURATION ──────────────────────────
   👇 MODIFIEZ CETTE LIGNE avec l'URL de votre backend
   Exemple local      : 'http://localhost:3001'
   Exemple production : 'https://snapload.up.railway.app'
   Laissez vide ''    : mode démo (sans téléchargement réel)
────────────────────────────────────────── */
const PROD_API_URL = 'https://snapload-backend-a040.onrender.com'; // ← VOTRE URL ICI

// En local (localhost), on utilise automatiquement le backend local
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const API_URL  = IS_LOCAL ? 'http://localhost:3001' : PROD_API_URL;

/* ────────────────────────────────────────── */

const IS_DEMO = !API_URL;

// Cacher le bandeau si l'API est configurée
if (!IS_DEMO) {
  document.getElementById('apiBanner').style.display = 'none';
}

// ══════════════════════════════════════════
// NAVIGATION — LIEN ACTIF AU SCROLL
// ══════════════════════════════════════════
function updateActiveNav() {
  const sections = document.querySelectorAll('section[id]');
  const links    = document.querySelectorAll('.nav-link');
  const scrollY  = window.scrollY + 100;

  sections.forEach(section => {
    const top    = section.offsetTop;
    const height = section.offsetHeight;
    const id     = section.getAttribute('id');

    if (scrollY >= top && scrollY < top + height) {
      links.forEach(l => l.classList.remove('active'));
      const active = document.querySelector(`.nav-link[href="#${id}"]`);
      if (active) active.classList.add('active');
    }
  });
}

window.addEventListener('scroll', updateActiveNav, { passive: true });

// Fermer le menu mobile au clic sur un lien
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.getElementById('navLinks').classList.remove('open');
  });
});

// ══════════════════════════════════════════
// MENU HAMBURGER MOBILE
// ══════════════════════════════════════════
function toggleMenu() {
  document.getElementById('navLinks').classList.toggle('open');
}

// ══════════════════════════════════════════
// FORMULAIRE CONTACT
// ══════════════════════════════════════════
async function submitContact(event) {
  event.preventDefault();

  const name  = document.getElementById('contactName').value.trim();
  const email = document.getElementById('contactEmail').value.trim();
  const msg   = document.getElementById('contactMsg').value.trim();

  if (!name || !email || !msg) {
    showToast('Veuillez remplir tous les champs requis.', 'error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Adresse email invalide.', 'error');
    return;
  }

  const form = document.getElementById('contactForm');
  const button = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  formData.set('name', name);
  formData.set('email', email);
  formData.set('message', msg);
  button.disabled = true;

  try {
    const response = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(formData).toString(),
    });
    if (!response.ok) throw new Error(`Netlify Forms a répondu ${response.status}`);

    form.reset();
    showToast('✓ Message envoyé ! Merci de nous avoir écrit.', 'success');
  } catch (err) {
    console.error('[contact]', err);
    showToast('Envoi impossible pour le moment. Vos informations ont été conservées.', 'error');
  } finally {
    button.disabled = false;
  }
}
function setTheme(dark) {
  document.body.classList.toggle('light', !dark);
  document.getElementById('darkBtn').classList.toggle('active', dark);
  document.getElementById('lightBtn').classList.toggle('active', !dark);
  try { localStorage.setItem('snapload_theme', dark ? 'dark' : 'light'); } catch {}
}

// Échappe le HTML pour éviter les injections (titres, URL…)
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Déclenche le téléchargement d'un blob
function saveBlob(blob, filename) {
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Révoquer trop tôt annule le téléchargement sur certains navigateurs
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ══════════════════════════════════════════
// DÉTECTION DE LA PLATEFORME
// ══════════════════════════════════════════

// 👇 Ajoutez ou modifiez les plateformes ici
const PLATFORMS = [
  { name: 'TikTok',      color: '#ff0050', patterns: ['tiktok.com', 'vm.tiktok'] },
  { name: 'YouTube',     color: '#ff0000', patterns: ['youtube.com', 'youtu.be'] },
  { name: 'Instagram',   color: '#e1306c', patterns: ['instagram.com'] },
  { name: 'Facebook',    color: '#1877f2', patterns: ['facebook.com', 'fb.watch'] },
  { name: 'Twitter / X', color: '#1da1f2', patterns: ['twitter.com', 'x.com'] },
  { name: 'Reddit',      color: '#ff4500', patterns: ['reddit.com', 'v.redd.it'] },
  { name: 'Twitch',      color: '#6441a5', patterns: ['twitch.tv'] },
  { name: 'Vimeo',       color: '#ff6900', patterns: ['vimeo.com'] },
];

function detectPlatform(url) {
  const lower = url.toLowerCase();
  return PLATFORMS.find(p => p.patterns.some(pat => lower.includes(pat))) || null;
}

// ══════════════════════════════════════════
// ÉTAT GLOBAL
// ══════════════════════════════════════════
let currentUrl      = '';
let currentPlatform = null;
let currentMethod   = 'demo';
let currentQualities = [];

// ══════════════════════════════════════════
// APPEL AU BACKEND RÉEL
// ══════════════════════════════════════════
async function fetchVideoInfo(url) {
  // Le serveur gratuit peut mettre ~30 s à se réveiller : on prévient l'utilisateur
  const slowTimer = setTimeout(() => {
    showInfo('⏳ Le serveur se réveille, cela peut prendre jusqu\'à 30 secondes…');
  }, 4000);
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 90000);

  try {
    const res = await fetch(`${API_URL}/api/info?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erreur serveur' }));
      throw new Error(err.error || `Erreur ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Le serveur met trop de temps à répondre. Réessayez dans un instant.');
    if (err instanceof TypeError) throw new Error('Impossible de joindre le serveur. Vérifiez votre connexion.');
    throw err;
  } finally {
    clearTimeout(slowTimer);
    clearTimeout(abortTimer);
    hideError();
  }
}

// ══════════════════════════════════════════
// DONNÉES DE DÉMONSTRATION (mode sans backend)
// ══════════════════════════════════════════
function getMockData(platformName) {
  const map = {
    TikTok: {
      title: 'Clip TikTok — Contenu viral #fyp',
      duration: '0:28',
      qualities: [
        { label: '1080p', info: 'Full HD · MP4', recommended: true },
        { label: '720p',  info: 'HD · MP4' },
        { label: '480p',  info: 'SD · MP4' },
      ]
    },
    YouTube: {
      title: 'Vidéo YouTube — Titre de la vidéo',
      duration: '8:42',
      qualities: [
        { label: '4K',    info: '2160p · MP4' },
        { label: '1080p', info: 'Full HD · MP4', recommended: true },
        { label: '720p',  info: 'HD · MP4' },
        { label: '480p',  info: 'SD · MP4' },
        { label: '360p',  info: 'Mobile · MP4' },
      ]
    },
    Instagram: {
      title: 'Reel Instagram — Vidéo partagée',
      duration: '0:45',
      qualities: [
        { label: '1080p', info: 'Full HD · MP4', recommended: true },
        { label: '720p',  info: 'HD · MP4' },
      ]
    },
  };
  return map[platformName] || {
    title: 'Vidéo en ligne',
    duration: '3:00',
    qualities: [
      { label: '1080p', info: 'Full HD · MP4', recommended: true },
      { label: '720p',  info: 'HD · MP4' },
    ]
  };
}

// ══════════════════════════════════════════
// LOGIQUE PRINCIPALE — ANALYSER L'URL
// ══════════════════════════════════════════
async function analyzeUrl() {
  if (document.getElementById('downloadBtn').classList.contains('loading')) return;
  const url = document.getElementById('url-input').value.trim();

  // Validations
  if (!url) {
    showError('⚠️ Veuillez coller un lien vidéo.');
    return;
  }
  try { new URL(url); } catch {
    showError('❌ Ce lien ne semble pas valide. Vérifiez que vous avez copié l\'URL complète.');
    return;
  }

  const platform = detectPlatform(url);
  if (!platform) {
    showError('🔍 Plateforme non reconnue. Essayez TikTok, YouTube, Instagram…');
    return;
  }

  // Préparer l'interface
  currentUrl      = url;
  currentPlatform = platform;
  hideError();
  setLoading(true);
  document.getElementById('results-panel').classList.remove('visible');

  try {
    let data;

    if (IS_DEMO) {
      // Mode démo : simulation d'un délai réseau
      await delay(1200 + Math.random() * 600);
      const mock = getMockData(platform.name);
      currentMethod    = 'demo';
      currentQualities = mock.qualities;
      data = { title: mock.title, thumbnail: '', duration: mock.duration };

    } else {
      // Mode production : appel réel au backend
      const info    = await fetchVideoInfo(url);
      currentMethod    = info.method;
      currentQualities = info.qualities;
      data = info;
    }

    setLoading(false);
    renderResults(platform, data);
    addToHistory(url, platform.name);

  } catch (err) {
    setLoading(false);
    showError('❌ ' + escapeHtml(err.message || 'Impossible de récupérer les informations de cette vidéo.'));
  }
}

// ══════════════════════════════════════════
// AFFICHER LES RÉSULTATS
// ══════════════════════════════════════════
function renderResults(platform, data) {
  // Nom de la plateforme
  document.getElementById('resultPlatform').innerHTML =
    `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${platform.color};margin-right:5px"></span>${escapeHtml(platform.name)}`;

  document.getElementById('resultTitle').textContent    = data.title || 'Vidéo';
  document.getElementById('resultDuration').textContent = data.duration ? '⏱ ' + formatDuration(data.duration) : '';

  // Miniature
  const thumb = document.getElementById('resultThumb');
  const fallback = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,${platform.color}22,${platform.color}44)">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="${platform.color}" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
    </div>`;
  if (data.thumbnail) {
    const img = new Image();
    img.alt = 'miniature';
    img.onerror = () => { thumb.innerHTML = fallback; };
    img.src = data.thumbnail;
    thumb.innerHTML = '';
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = fallback;
  }

  // Boutons de qualité
  const grid = document.getElementById('qualityGrid');
  grid.innerHTML = '';
  if (!currentQualities || !currentQualities.length) {
    grid.innerHTML = '<div class="quality-info">Aucune qualité disponible pour cette vidéo.</div>';
  }

  currentQualities.forEach((q, i) => {
    const btn   = document.createElement('button');
    btn.className = 'quality-btn' + (q.recommended ? ' recommended' : '');
    const label = q.label || q.quality || 'Auto';
    const info  = q.info  || (q.ext ? q.ext.toUpperCase() : 'MP4');
    btn.innerHTML = `
      <span class="quality-badge">${escapeHtml(label)}</span>
      <span class="quality-info">${escapeHtml(info)}</span>
      ${q.recommended ? '<br><span class="rec-badge">Recommandé</span>' : ''}
    `;
    btn.onclick = () => startDownload(q);
    grid.appendChild(btn);
  });

  document.getElementById('results-panel').classList.add('visible');
}

// ══════════════════════════════════════════
// TÉLÉCHARGER UNE QUALITÉ
// ══════════════════════════════════════════
function getFilename(label) {
  // Génère un nom de fichier propre depuis le titre de la vidéo
  const titre = document.getElementById('resultTitle').textContent.trim();
  const platform = currentPlatform ? currentPlatform.name.toLowerCase() : 'video';
  const clean = titre
    .substring(0, 50)
    .replace(/[^\w\s-]/g, '')   // Supprimer les caractères spéciaux
    .trim()
    .replace(/\s+/g, '_')        // Espaces → underscores
    .toLowerCase() || 'video';
  return `${platform}_${clean}_${label}.mp4`;
}

let isDownloading = false;

function startDownload(quality) {
  if (isDownloading) return;

  const progress = document.getElementById('dlProgress');
  const bar      = document.getElementById('dlBar');
  const text     = document.getElementById('dlText');

  const reset = () => {
    isDownloading = false;
    progress.classList.remove('active');
    bar.style.width = '0%';
  };

  isDownloading = true;
  hideError();
  progress.classList.add('active');

  // Mode démo
  if (IS_DEMO || currentMethod === 'demo') {
    animateProgress(bar, text, () => {
      showToast('ℹ️ Mode démo — aucun fichier réel téléchargé', 'success');
      reset();
    });
    return;
  }

  let endpoint, body;
  const filename = getFilename(quality.label || quality.format_id || 'hd');

  if (currentMethod === 'rapidapi' && quality.directUrl) {
    // RapidAPI : proxy via le backend pour contourner le CORS
    endpoint = '/api/proxy-download';
    body     = { directUrl: quality.directUrl, filename };
  } else if (currentMethod === 'ytdlp' && quality.format_id) {
    // yt-dlp : le backend streame le fichier
    endpoint = '/api/download';
    body     = { url: currentUrl, format_id: quality.format_id };
  } else {
    reset();
    showError('❌ Ce format ne peut pas être téléchargé. Essayez une autre qualité.');
    return;
  }

  bar.style.width  = '30%';
  text.textContent = 'Connexion au serveur…';

  fetch(API_URL + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  .then(async res => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erreur de téléchargement (${res.status})`);
    }
    bar.style.width  = '70%';
    text.textContent = 'Réception du fichier…';
    return res.blob();
  })
  .then(blob => {
    bar.style.width  = '100%';
    text.textContent = '✓ Terminé !';
    saveBlob(blob, filename);
    showToast(`✓ Téléchargement ${escapeHtml(quality.label || '')} terminé !`, 'success');
    setTimeout(reset, 2000);
  })
  .catch(err => {
    reset();
    showError('❌ ' + escapeHtml(err.message));
  });
}

// ══════════════════════════════════════════
// TÉLÉCHARGER AUDIO MP3
// ══════════════════════════════════════════
let isAudioLoading = false;

function downloadAudio() {
  if (IS_DEMO) {
    showToast('ℹ️ Mode démo — aucun fichier réel téléchargé', 'success');
    return;
  }
  if (!currentUrl) {
    showError("⚠️ Analysez d'abord une vidéo.");
    return;
  }
  if (isAudioLoading) return;

  const btn = document.querySelector('.audio-dl-btn');
  isAudioLoading = true;
  btn.disabled = true;
  showToast("🎵 Extraction de l'audio en cours…", 'success');

  fetch(`${API_URL}/api/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: currentUrl })
  })
  .then(async res => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Extraction échouée');
    }
    return res.blob();
  })
  .then(blob => {
    saveBlob(blob, getFilename('audio').replace(/\.mp4$/, '.mp3'));
    showToast('🎵 Audio MP3 téléchargé !', 'success');
  })
  .catch(err => showError('❌ ' + escapeHtml(err.message)))
  .finally(() => { isAudioLoading = false; btn.disabled = false; });
}

// ══════════════════════════════════════════
// COLLER DEPUIS LE PRESSE-PAPIERS
// ══════════════════════════════════════════
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      document.getElementById('url-input').value = text;
      showToast('📋 Lien collé !', 'success');
    }
  } catch {
    showToast('Collez le lien manuellement avec Ctrl+V', 'error');
  }
}

// ══════════════════════════════════════════
// HISTORIQUE (stocké localement)
// ══════════════════════════════════════════
function getHistory() {
  try { return JSON.parse(localStorage.getItem('snapload_history') || '[]'); }
  catch { return []; }
}

function addToHistory(url, platform) {
  const hist = getHistory().filter(h => h.url !== url);
  hist.unshift({ url, platform, ts: Date.now() });
  try { localStorage.setItem('snapload_history', JSON.stringify(hist.slice(0, 8))); } catch {}
  renderHistory();
}

function renderHistory() {
  const hist = getHistory();
  const sec  = document.getElementById('historySection');
  const list = document.getElementById('historyList');

  if (!hist.length) { sec.classList.remove('visible'); return; }
  sec.classList.add('visible');

  list.innerHTML = hist.map(h => `
    <div class="history-item" onclick="loadFromHistory('${encodeURIComponent(h.url)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="1 4 1 10 7 10"/>
        <path d="M3.51 15a9 9 0 1 0 .49-3.01"/>
      </svg>
      <span class="history-url">${escapeHtml(h.url)}</span>
      <span class="history-platform">${escapeHtml(h.platform)}</span>
    </div>
  `).join('');
}

function loadFromHistory(encoded) {
  document.getElementById('url-input').value = decodeURIComponent(encoded);
  analyzeUrl();
}

function clearHistory() {
  try { localStorage.removeItem('snapload_history'); } catch {}
  renderHistory();
  showToast('Historique effacé', 'success');
}

// ══════════════════════════════════════════
// FAQ
// ══════════════════════════════════════════

// 👇 Modifiez les questions/réponses ici
const FAQS = [
  {
    q: 'Est-ce vraiment gratuit ?',
    a: 'Oui, SnapLoad est 100% gratuit. Aucune inscription requise.'
  },
  {
    q: 'Mes données sont-elles stockées ?',
    a: 'Non. Aucun lien ni vidéo n\'est stocké côté serveur. Votre historique reste uniquement sur votre appareil.'
  },
  {
    q: 'Pourquoi certaines vidéos ne fonctionnent pas ?',
    a: 'Les vidéos privées ou protégées par DRM ne peuvent pas être téléchargées. Assurez-vous que la vidéo est publique.'
  },
  {
    q: 'Est-ce légal ?',
    a: 'Le téléchargement à usage personnel est toléré dans de nombreux pays. Redistribuer du contenu protégé est illégal. Utilisez cet outil de manière responsable.'
  },
  {
    q: 'Le premier téléchargement est lent, pourquoi ?',
    a: "Notre serveur se met en veille quand il n'est pas utilisé. La première analyse peut prendre jusqu'à 30 secondes, les suivantes sont rapides."
  },
];

function buildFaq() {
  document.getElementById('faqList').innerHTML = FAQS.map((f, i) => `
    <div class="faq-item" id="fi${i}">
      <div class="faq-question" role="button" tabindex="0" aria-expanded="false" id="fq${i}"
           onclick="toggleFaq(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleFaq(${i})}">
        <span>${f.q}</span>
        <svg class="faq-chevron" id="fc${i}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="faq-answer" id="fa${i}">
        <div class="faq-answer-inner">${f.a}</div>
      </div>
    </div>
  `).join('');
}

const openFaqs = new Set();

function toggleFaq(i) {
  const answer  = document.getElementById('fa' + i);
  const chevron = document.getElementById('fc' + i);
  const item    = document.getElementById('fi' + i);

  if (openFaqs.has(i)) {
    answer.style.maxHeight = '0';
    item.classList.remove('open');
    document.getElementById('fq' + i).setAttribute('aria-expanded', 'false');
    openFaqs.delete(i);
  } else {
    answer.style.maxHeight = answer.scrollHeight + 'px';
    item.classList.add('open');
    document.getElementById('fq' + i).setAttribute('aria-expanded', 'true');
    openFaqs.add(i);
  }
}

// ══════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════
function setLoading(v) {
  document.getElementById('downloadBtn').classList.toggle('loading', v);
}

function showError(msg) {
  const el    = document.getElementById('errorMsg');
  el.className = 'msg error';
  el.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    ${msg}
  `;
}

function showInfo(msg) {
  const el     = document.getElementById('errorMsg');
  el.className = 'msg info';
  el.textContent = msg;
}

function hideError() {
  document.getElementById('errorMsg').className = 'msg';
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatDuration(secs) {
  if (typeof secs === 'string') return secs;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function animateProgress(bar, text, callback) {
  let p = 0;
  const interval = setInterval(() => {
    p += Math.random() * 20;
    if (p >= 100) {
      p = 100;
      clearInterval(interval);
      text.textContent = '✓ Terminé';
      setTimeout(callback, 800);
    } else {
      text.textContent = Math.round(p) + '%…';
    }
    bar.style.width = p + '%';
  }, 200);
}

function showToast(msg, type = 'success') {
  const container = document.getElementById('toasts');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success'
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>`;

  toast.innerHTML = icon + `<span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.cssText += 'opacity:0;transform:translateX(20px);transition:0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ══════════════════════════════════════════
// INITIALISATION
// ══════════════════════════════════════════
document.addEventListener('click', e => {
  const nav = document.getElementById('navLinks');
  if (nav.classList.contains('open') && !e.target.closest('#navLinks, #hamburger')) {
    nav.classList.remove('open');
  }
});

(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('snapload_theme'); } catch {}
  if (saved) setTheme(saved === 'dark');
})();

buildFaq();
renderHistory();
updateActiveNav();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || IS_LOCAL)) {
  navigator.serviceWorker.register('./service-worker.js')
    .catch(error => console.error('[service worker]', error));
}

const sharedParams = new URLSearchParams(location.search);
const sharedText = sharedParams.get('text') || '';
const sharedUrl = sharedParams.get('url')
  || sharedText.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.!?]+$/, '');

if (sharedUrl) {
  document.getElementById('url-input').value = sharedUrl;
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  requestAnimationFrame(() => {
    document.getElementById('accueil').scrollIntoView();
    analyzeUrl();
  });
}
