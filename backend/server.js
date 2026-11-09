/**
 * SnapLoad — Backend Express
 * Téléchargeur de vidéos via yt-dlp (gratuit) ou RapidAPI (cloud)
 *
 * Installation : npm install
 * Lancement    : node server.js
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { isSafeRemoteUrl, resolveSafeRemoteUrl } = require('./remote-url');
require('dotenv').config();
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3001;

// ═══════════════════════════════════════
// INSTALLATION AUTOMATIQUE DE yt-dlp (cross-plateforme)
// Télécharge yt-dlp au démarrage si absent. Sur Windows on télécharge yt-dlp.exe.
// Utilise le dossier temporaire du système (os.tmpdir()) pour être compatible.
// ═══════════════════════════════════════
const IS_WINDOWS = process.platform === 'win32';
const YTDLP_NAME = IS_WINDOWS ? 'yt-dlp.exe' : 'yt-dlp';
function findYtDlpOnPath() {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(directory, YTDLP_NAME);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

const SYSTEM_YTDLP_PATH = findYtDlpOnPath();
const YTDLP_PATH = process.env.YTDLP_PATH || SYSTEM_YTDLP_PATH || path.join(os.tmpdir(), YTDLP_NAME);
const YTDLP_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
let ytdlpVersion = 'unknown';
let ytdlpImpersonate = process.env.YTDLP_IMPERSONATE || '';

function getYtDlpVersion() {
  return new Promise((resolve) => {
    execFile(YTDLP_PATH, ['--version'], { timeout: 10000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

function detectYtDlpImpersonation() {
  if (ytdlpImpersonate) return Promise.resolve();
  return new Promise((resolve) => {
    execFile(YTDLP_PATH, ['--list-impersonate-targets'], { timeout: 10000 }, (error, stdout) => {
      if (!error && /curl_cffi/i.test(stdout)) {
        ytdlpImpersonate = 'chrome';
        console.log('✅ Impersonation navigateur activée pour yt-dlp');
      }
      resolve();
    });
  });
}

function isYtDlpVersionStale(version) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(version || '');
  if (!match) return true;
  const releasedAt = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return !Number.isFinite(releasedAt) || Date.now() - releasedAt > YTDLP_STALE_AFTER_MS;
}

async function installYtDlp() {
  if (!process.env.YTDLP_PATH && SYSTEM_YTDLP_PATH) {
    const version = await getYtDlpVersion();
    if (!version) throw new Error('yt-dlp est installé dans PATH mais ne peut pas être exécuté');
    ytdlpVersion = version;
    await detectYtDlpImpersonation();
    console.log('✅ yt-dlp', ytdlpVersion, 'utilisé depuis PATH :', YTDLP_PATH);
    return;
  }

  let existingVersion = null;
  try {
    if (fs.statSync(YTDLP_PATH).size > 1024 * 1024) {
      existingVersion = await getYtDlpVersion();
      if (existingVersion && !isYtDlpVersionStale(existingVersion)) {
        ytdlpVersion = existingVersion;
        await detectYtDlpImpersonation();
        console.log('✅ yt-dlp', ytdlpVersion, 'déjà disponible à', YTDLP_PATH);
        return;
      }
    }
  } catch {}

  console.log('📥 Téléchargement de yt-dlp dans', YTDLP_PATH,
    existingVersion ? `(version actuelle : ${existingVersion})` : '');
  return new Promise((resolve, reject) => {
    const downloadUrl = IS_WINDOWS
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
    const partPath = YTDLP_PATH + '.part';

    const fail = (msg) => {
      console.error('Erreur yt-dlp:', msg);
      fs.unlink(partPath, () => {});
      if (existingVersion) {
        console.error('Utilisation de la version existante de yt-dlp:', existingVersion);
        ytdlpVersion = existingVersion;
        resolve();
      } else {
        reject(new Error('Installation de yt-dlp impossible : ' + msg));
      }
    };

    // GitHub enchaîne plusieurs redirections : on les suit toutes
    const get = (url, redirects = 0) => {
      if (redirects > 5) return fail('trop de redirections');
      https.get(url, { headers: { 'User-Agent': 'SnapLoad' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return get(new URL(res.headers.location, url).href, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail('statut HTTP ' + res.statusCode);
        }
        const file = fs.createWriteStream(partPath);
        res.pipe(file);
        file.on('error', (e) => fail(e.message));
        file.on('finish', () => {
          file.close(() => {
            fs.rename(partPath, YTDLP_PATH, (err) => {
              const finishInstall = (renameError) => {
                if (renameError) return fail(renameError.message);
                try {
                  if (!IS_WINDOWS) fs.chmodSync(YTDLP_PATH, 0o755);
                } catch (chmodError) {
                  return fail(chmodError.message);
                }
                getYtDlpVersion().then((version) => {
                  if (!version) return fail('version yt-dlp impossible à vérifier');
                  ytdlpVersion = version;
                  detectYtDlpImpersonation().then(() => {
                    console.log('✅ yt-dlp', ytdlpVersion, 'installé avec succès');
                    resolve();
                  });
                });
              };

              if (!err) return finishInstall();
              if (!IS_WINDOWS || !existingVersion) return finishInstall(err);
              fs.unlink(YTDLP_PATH, (unlinkError) => {
                if (unlinkError && unlinkError.code !== 'ENOENT') return finishInstall(unlinkError);
                fs.rename(partPath, YTDLP_PATH, finishInstall);
              });
            });
          });
        });
      }).on('error', (e) => fail(e.message))
        .setTimeout(60000, function () { this.destroy(new Error('délai dépassé')); });
    };
    get(downloadUrl);
  });
}

// ═══════════════════════════════════════
// MIDDLEWARES
// ═══════════════════════════════════════
app.set('trust proxy', 1); // Nécessaire sur Render/Heroku derrière un proxy
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Limite : 20 requêtes par IP toutes les 10 minutes
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de requêtes. Réessayez dans 10 minutes.' },
  skip: (req) => req.path === '/proxy-image'
});
app.use('/api/', limiter);

// Les miniatures sont appelées plusieurs fois par analyse : limite séparée, plus large.
app.use('/api/proxy-image', rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  message: { error: 'Trop de miniatures demandées. Réessayez dans 10 minutes.' }
}));

// ═══════════════════════════════════════
// VALIDATION DE L'URL
// ═══════════════════════════════════════
const ALLOWED_DOMAINS = [
  'tiktok.com', 'vm.tiktok.com',
  'youtube.com', 'youtu.be',
  'instagram.com',
  'facebook.com', 'fb.watch',
  'twitter.com', 'x.com',
  'reddit.com', 'v.redd.it',
  'twitch.tv',
  'dailymotion.com',
  'vimeo.com'
];

function isAllowedUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return false;
    const host = hostname.toLowerCase();
    // Correspondance exacte ou sous-domaine (évite "evilx.com" pour "x.com")
    return ALLOWED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

// Taille lisible (la vidéo finale inclut l'audio, donc c'est une estimation)
function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko';
  return '~' + (bytes / 1024 / 1024).toFixed(1) + ' Mo';
}

// Nom de fichier sûr pour l'en-tête Content-Disposition
function safeFilename(name, fallback) {
  const clean = String(name || '')
    .replace(/[^\w.\- ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return clean || fallback;
}

// Lance yt-dlp SANS shell : l'URL ne peut pas injecter de commande
let ytdlpReady = Promise.resolve();

function addImpersonation(args) {
  return ytdlpImpersonate ? ['--impersonate', ytdlpImpersonate, ...args] : args;
}

async function runYtDlp(args, timeout) {
  await ytdlpReady; // attendre la fin de l'installation au démarrage
  return new Promise((resolve, reject) => {
    execFile(YTDLP_PATH, addImpersonation(args), { timeout, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(cleanYtDlpError(stderr || error.message)));
      else resolve(stdout);
    });
  });
}

// Message d'erreur lisible pour l'utilisateur
function cleanYtDlpError(msg) {
  const lines = String(msg).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const errorLine = [...lines].reverse().find(line => line.includes('ERROR:'));
  const traceback = lines.some(line => line.startsWith('Traceback (most recent call last):'));
  const details = errorLine || (traceback ? lines.slice(-3).join(' | ') : lines[0]) || 'Erreur yt-dlp';
  const diagnostic = details.replace(/^ERROR:\s*/, '');

  if (/private|login|sign in|cookies/i.test(diagnostic)) return 'Vidéo privée ou nécessitant une connexion.';
  if (/unavailable|not available|removed/i.test(diagnostic)) return 'Vidéo indisponible ou supprimée.';
  if (/unsupported url/i.test(diagnostic)) return 'Lien non pris en charge.';
  return diagnostic.slice(0, 300);
}

// ═══════════════════════════════════════
// MÉTHODE 1 : yt-dlp (LOCAL, GRATUIT)
// Installer : pip install yt-dlp
// ═══════════════════════════════════════
function getVideoInfoYtDlp(url) {
  return new Promise((resolve, reject) => {
    // --dump-json retourne les métadonnées sans télécharger
    runYtDlp(['--dump-json', '--no-playlist', '--', url], 60000).then(stdout => {
      try {
        // yt-dlp peut retourner des warnings avant le JSON — on prend la dernière ligne JSON valide
        let info = null;
        const output = stdout.trim();
        try {
          info = JSON.parse(output);
        } catch {
          for (const line of output.split(/\r?\n/)) {
            if (!line.trimStart().startsWith('{')) continue;
            try { info = JSON.parse(line); break; } catch {}
          }
        }
        if (!info || typeof info !== 'object' || Array.isArray(info)) {
          throw new Error('yt-dlp n’a retourné aucune métadonnée JSON valide');
        }
        // Construire la liste des qualités disponibles
        const formats = (info.formats || [])
          .filter(f => f.vcodec !== 'none' && f.ext === 'mp4')
          .map(f => ({
            format_id: f.format_id,
            quality:   f.height ? `${f.height}p` : f.format_note,
            ext:       f.ext,
            filesize:  f.filesize,
            fps:       f.fps,
            vcodec:    f.vcodec,
          }))
          .sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));

        // Une seule entrée par qualité : on garde celle dont la taille est connue / la plus lourde
        const byQuality = new Map();
        for (const f of formats) {
          const key = f.quality || f.format_id;
          const prev = byQuality.get(key);
          if (!prev || (f.filesize || 0) > (prev.filesize || 0)) byQuality.set(key, f);
        }
        const uniqueFormats = [...byQuality.values()]
          .sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));

        resolve({
          title:     info.title,
          thumbnail: info.thumbnail,
          duration:  info.duration,
          platform:  info.extractor_key,
          formats:   uniqueFormats,
          webpage_url: info.webpage_url,
        });
      } catch (error) {
        console.error('[yt-dlp metadata]', error.message);
        reject(new Error('Impossible de parser les infos vidéo : réponse yt-dlp invalide'));
      }
    }, reject);
  });
}

async function downloadWithYtDlp(url, formatId, outputPath) {
  await runYtDlp([
    '-f', `${formatId}+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best`,
    '--merge-output-format', 'mp4', '--no-playlist',
    '-o', outputPath, '--', url
  ], 180000);
  return outputPath;
}

// outputBase : chemin SANS extension ; yt-dlp ajoute .mp3 après conversion
async function extractAudioWithYtDlp(url, outputBase) {
  await runYtDlp([
    '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--no-playlist',
    '-o', outputBase + '.%(ext)s', '--', url
  ], 180000);
  return outputBase + '.mp3';
}

// Envoie un fichier temporaire puis le supprime (même si le client coupe)
function streamTempFile(res, file, filename, contentType) {
  const cleanup = () => fs.unlink(file, () => {});
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);
  try { res.setHeader('Content-Length', fs.statSync(file).size); } catch {}
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    cleanup();
    if (!res.headersSent) res.status(500).json({ error: 'Erreur de streaming' });
    else res.destroy();
  });
  res.on('close', cleanup);
  stream.pipe(res);
}

// ═══════════════════════════════════════
// MÉTHODE 2 : RapidAPI (CLOUD)
// Créer un compte sur rapidapi.com
// Souscrire à "All Video Downloader" ou "Social Media Video Downloader"
// Mettre la clé dans .env : RAPIDAPI_KEY=votre_clé
// ═══════════════════════════════════════
function getVideoInfoRapidApi(url) {
  return new Promise((resolve, reject) => {
    if (!process.env.RAPIDAPI_KEY) {
      reject(new Error('RAPIDAPI_KEY non configurée dans .env'));
      return;
    }

    // API : "Social Download All In One" by manh'g
    // POST /v1/social/autolink
    const body = JSON.stringify({ url });

    const options = {
      method: 'POST',
      hostname: 'social-download-all-in-one.p.rapidapi.com',
      path: '/v1/social/autolink',
      headers: {
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(body),
        'X-RapidAPI-Key':  process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'social-download-all-in-one.p.rapidapi.com'
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          const medias = json.medias || json.links || json.data || [];

          // Filtrer uniquement les vraies videos (type=video, extension=mp4)
          const qualityLabels = {
            'hd_no_watermark':  { label: 'HD',      info: 'Sans filigrane' },
            'no_watermark':     { label: '720p',     info: 'Sans filigrane' },
            'no_watermark_hd':  { label: 'Full HD',  info: 'Sans filigrane' },
            'watermark':        { label: 'SD',       info: 'Avec filigrane' },
            'hd':               { label: 'HD',       info: 'MP4' },
            'sd':               { label: 'SD',       info: 'MP4' },
          };

          const qualities = medias
            .filter(m => m.url && m.url.startsWith('http') && m.type === 'video' && m.extension === 'mp4')
            .map((m, i) => {
              const raw   = (m.quality || '').toLowerCase().replace(/\s+/g, '_');
              const known = qualityLabels[raw];
              return {
                label:       known ? known.label : (m.resolution || m.quality || ('Option ' + (i+1))),
                info:        known ? known.info  : 'MP4',
                directUrl:   m.url,
                recommended: raw.includes('hd') && !raw.includes('watermark') ? true : i === 0,
              };
            });

          if (qualities.length === 0) {
            reject(new Error('Aucun lien trouvé. La vidéo est peut-être privée.'));
            return;
          }

          resolve({
            title:     json.title     || json.name    || 'Vidéo',
            thumbnail: json.thumbnail || json.picture || json.cover || '',
            duration:  json.duration > 10000 ? Math.round(json.duration / 1000) : json.duration || null,
            platform:  json.source    || json.src     || 'unknown',
            links:     qualities,
          });

        } catch (e) {
          console.error('[RapidAPI error]', e.message);
          reject(new Error('Réponse API invalide : ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('RapidAPI ne répond pas')));
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════
// ROUTES API
// ═══════════════════════════════════════

// GET /api/info?url=...
// Retourne les métadonnées + qualités disponibles
app.get('/api/info', async (req, res) => {
  const { url } = req.query;

  if (!url)              return res.status(400).json({ error: 'URL manquante' });
  if (!isAllowedUrl(url)) return res.status(400).json({ error: 'Plateforme non supportée' });

  try {
    // YouTube → toujours yt-dlp. Autres plateformes → RapidAPI si configuré,
    // avec yt-dlp en secours si le fournisseur échoue.
    const hostname = new URL(url).hostname.toLowerCase();
    const isYoutube = hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
    const method = isYoutube
      ? 'ytdlp'
      : (process.env.DOWNLOAD_METHOD === 'rapidapi' || process.env.RAPIDAPI_KEY
        ? 'rapidapi'
        : 'ytdlp');

    if (method === 'rapidapi') {
      try {
        const info = await getVideoInfoRapidApi(url);
        const host = req.protocol + '://' + req.get('host');
        return res.json({
          method: 'rapidapi',
          title:     info.title,
          thumbnail: info.thumbnail ? `${host}/api/proxy-image?url=${encodeURIComponent(info.thumbnail)}` : '',
          duration:  info.duration,
          platform:  info.platform,
          qualities: info.links.map(l => ({
            label:       l.label || 'Auto',
            directUrl:   l.directUrl,
            info:        l.info,
            recommended: l.recommended,
          }))
        });
      } catch (error) {
        if (!process.env.RAPIDAPI_KEY) throw error;
        console.error('[RapidAPI fallback]', cleanYtDlpError(error.message));
      }
    }

    const info = await getVideoInfoYtDlp(url);
    return res.json({
      method: 'ytdlp',
      title:     info.title,
      thumbnail: info.thumbnail,
      duration:  info.duration,
      platform:  info.platform,
      qualities: (() => {
        const recIndex = Math.max(0, info.formats.findIndex(f => (parseInt(f.quality) || 0) <= 1080));
        return info.formats.map((f, i) => ({
          label:       f.quality || 'Auto',
          format_id:   f.format_id,
          ext:         f.ext,
          filesize:    f.filesize,
          info:        (f.ext || 'mp4').toUpperCase() + (f.filesize ? ' · ' + formatSize(f.filesize) : ''),
          recommended: i === recIndex,
        }));
      })()
    });
  } catch (err) {
    console.error('[/api/info]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/proxy-image?url=...
// Proxy pour les miniatures bloquées par CORS (TikTok, Instagram)
app.get('/api/proxy-image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('URL manquante');
  if (!isSafeRemoteUrl(url)) return res.status(400).send('URL non autorisée');

  let destination;
  try {
    destination = await resolveSafeRemoteUrl(url);
  } catch {
    return res.status(400).send('URL non autorisée');
  }

  const protocol = destination.url.protocol === 'https:' ? https : http;
  protocol.get(destination.url, {
    lookup: destination.lookup,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tiktok.com/' },
    timeout: 15000
  }, (proxyRes) => {
    const type = proxyRes.headers['content-type'] || 'image/jpeg';
    // N'accepter que des images (évite d'en faire un proxy ouvert)
    if (proxyRes.statusCode !== 200 || !type.startsWith('image/')) {
      proxyRes.resume();
      return res.status(502).send('Image indisponible');
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    proxyRes.pipe(res);
  }).on('error', () => { if (!res.headersSent) res.status(500).send('Erreur image'); })
    .on('timeout', function () { this.destroy(new Error('timeout')); });
});

// POST /api/proxy-download
// Télécharge depuis une URL distante avec suivi des redirections
app.post('/api/proxy-download', async (req, res) => {
  const { directUrl, filename } = req.body;
  if (!directUrl) return res.status(400).json({ error: 'directUrl manquante' });
  if (!isSafeRemoteUrl(directUrl)) return res.status(400).json({ error: 'URL non autorisée' });
  const outName = safeFilename(filename, 'video.mp4');

  async function fetchWithRedirects(url, redirectCount = 0) {
    if (redirectCount > 5) {
      throw new Error('Trop de redirections');
    }

    const destination = await resolveSafeRemoteUrl(url);
    const protocol = destination.url.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Referer':    'https://www.tiktok.com/',
      'Accept':     '*/*',
    };

    const request = protocol.get(destination.url, { headers, lookup: destination.lookup }, (proxyRes) => {
      // Suivre les redirections 301/302
      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        proxyRes.resume();
        fetchWithRedirects(new URL(proxyRes.headers.location, destination.url).href, redirectCount + 1)
          .catch((err) => {
            if (!res.headersSent) res.status(400).json({ error: 'Redirection non autorisée' });
          });
        return;
      }

      if (proxyRes.statusCode !== 200) {
        console.error('[proxy] Status', proxyRes.statusCode);
        proxyRes.resume();
        res.status(502).json({ error: 'Erreur serveur distant: ' + proxyRes.statusCode });
        return;
      }

      res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'video/mp4');
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      res.on('close', () => proxyRes.destroy());
      proxyRes.pipe(res);

    });

    request.on('error', (err) => {
      console.error('[proxy-download]', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  }

  fetchWithRedirects(directUrl).catch((err) => {
    console.error('[proxy-download]', err.message);
    if (!res.headersSent) {
      const status = err.message === 'URL non autorisée' ? 400 : 502;
      res.status(status).json({ error: status === 400 ? err.message : 'Impossible de contacter le serveur distant' });
    }
  });
});

// POST /api/download
// Télécharge la vidéo et la streame au client (mode yt-dlp uniquement)
app.post('/api/download', async (req, res) => {
  const { url, format_id } = req.body;

  if (!url || !format_id) return res.status(400).json({ error: 'Paramètres manquants' });
  if (!isAllowedUrl(url))  return res.status(400).json({ error: 'URL non autorisée' });
  if (!/^[\w\-]{1,40}$/.test(String(format_id))) return res.status(400).json({ error: 'Format invalide' });

  const tmpFile = path.join(os.tmpdir(), `snapload_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);

  try {
    await downloadWithYtDlp(url, format_id, tmpFile);
    streamTempFile(res, tmpFile, 'video.mp4', 'video/mp4');
  } catch (err) {
    fs.unlink(tmpFile, () => {});
    console.error('[/api/download]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audio
// Extrait l'audio MP3
app.post('/api/audio', async (req, res) => {
  const { url } = req.body;

  if (!url)              return res.status(400).json({ error: 'URL manquante' });
  if (!isAllowedUrl(url)) return res.status(400).json({ error: 'URL non autorisée' });

  const tmpBase = path.join(os.tmpdir(), `snapload_audio_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const tmpFile = tmpBase + '.mp3';

  try {
    await extractAudioWithYtDlp(url, tmpBase);
    streamTempFile(res, tmpFile, 'audio.mp3', 'audio/mpeg');
  } catch (err) {
    fs.unlink(tmpFile, () => {});
    console.error('[/api/audio]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sanity check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    method: process.env.DOWNLOAD_METHOD || 'ytdlp',
    ytdlpVersion,
    impersonation: ytdlpImpersonate || null
  });
});

// Le serveur écoute tout de suite (health check OK) ; yt-dlp s'installe en parallèle
app.listen(PORT, () => {
  console.log(`\n🚀 SnapLoad Backend démarré sur http://localhost:${PORT}`);
  console.log(`📦 Méthode : ${process.env.DOWNLOAD_METHOD || 'ytdlp'}`);
  console.log(`🔑 RapidAPI Key : ${process.env.RAPIDAPI_KEY ? '✓ configurée' : '✗ non configurée'}\n`);
});
ytdlpReady = installYtDlp();
