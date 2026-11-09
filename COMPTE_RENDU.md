# Compte rendu — SnapLoad

Les sources du projet et les déploiements Netlify/Render évoluent séparément. Vérifier leurs états respectifs avant chaque mise en production.

## ⚠️ À savoir en premier

1. **Faille critique corrigée dans le backend** : l'URL envoyée par l'utilisateur était collée dans une commande shell (`exec`).
   N'importe qui pouvait exécuter des commandes sur ton serveur Render (ex. `...?v=x"&commande&"`).
   Corrigé (yt-dlp lancé sans shell) et testé : l'injection ne s'exécute plus.
   → **Redéploie le backend dès que possible.**
2. SnapLoad possède maintenant son propre dépôt Git. Le `.gitignore` exclut `.env` et `node_modules`.

## Frontend

### Polices et couleurs
- 4 polices mélangées (Syne, DM Sans, Playfair, Merriweather forcé en `!important` sur la zone de téléchargement)
  → 2 polices : **Plus Jakarta Sans** (titres) + **Inter** (texte). Merriweather était chargé deux fois.
- Titre principal plus grand et plus lisible.
- **Thème clair réparé** : la barre de navigation restait noire, les sections alternées et les ombres
  ne s'adaptaient pas, le bouton actif avait une ombre blanche, les erreurs manquaient de contraste.

### Bugs corrigés
- Bouton thème : cliquer sur 🌙 alors qu'on était déjà en sombre basculait en clair. Le choix est maintenant mémorisé.
- Faille XSS : l'historique, le titre, les qualités et les messages d'erreur étaient injectés en HTML sans échappement.
- Miniature : le fallback en cas d'image cassée produisait un SVG invalide.
- Téléchargement : la barre de progression restait bloquée si le format n'était pas téléchargeable ;
  les doubles clics lançaient plusieurs téléchargements ; le fichier pouvait être annulé
  (`revokeObjectURL` appelé trop tôt sous Firefox).
- MP3 : pas de vérification qu'une vidéo était analysée, aucun retour visuel, fichier toujours nommé `audio.mp3`.
- FAQ : hauteur fixe de 300 px (texte coupé) → hauteur réelle. Question « Comment connecter le backend ? »
  (destinée au développeur) remplacée par une explication sur le réveil lent du serveur.
- Formulaire de contact : validation du format email.
- Le menu mobile se ferme au clic en dehors ; le lien actif est correct dès le chargement.

### Améliorations
- Message « Le serveur se réveille… » après 4 s d'attente (Render gratuit), délai maximal de 90 s,
  messages d'erreur clairs (« Impossible de joindre le serveur » au lieu de « Failed to fetch »).
- En local (`localhost`), le front utilise automatiquement `http://localhost:3001` ; en ligne, Render.
- Accessibilité : labels liés aux champs, FAQ utilisable au clavier, focus visible,
  respect de « réduire les animations », zone d'erreur annoncée aux lecteurs d'écran.
- Balises `description` et `theme-color` pour le référencement et le mobile.

## Backend (`server.js`)

- **Injection de commandes** (voir plus haut) + validation de `format_id`.
- Filtre de domaines contournable : `evilx.com` passait pour `x.com` → correspondance exacte ou sous-domaine.
- **SSRF** : `/api/proxy-image` et `/api/proxy-download` acceptaient n'importe quelle URL (réseau interne,
  métadonnées cloud…) → adresses internes bloquées, proxy-image limité aux vraies images.
- Plantage possible du serveur : un nom de fichier contenant des guillemets ou des retours à la ligne faisait
  planter `setHeader` → nom nettoyé.
- **Installation de yt-dlp cassée** : seule la première redirection GitHub était suivie, ce qui écrivait un
  fichier vide de 0 octet, ensuite considéré comme « déjà installé » (`spawn EFTYPE`). Toutes les redirections
  sont suivies maintenant, avec écriture atomique, délai d'inactivité et réinstallation si le fichier est corrompu.
- Le serveur écoute tout de suite (health check Render OK) pendant que yt-dlp s'installe.
- Qualités dédoublonnées (YouTube renvoyait six « 240p ») avec taille estimée et qualité recommandée.
- Fichiers temporaires supprimés même si le client coupe ; extraction MP3 plus fiable ; messages d'erreur
  yt-dlp lisibles (vidéo privée, indisponible…) ; log complet de RapidAPI supprimé ; délai de 30 s sur RapidAPI.

## Tests effectués (en local)
- Injection, domaine piégé, SSRF, `format_id` malveillant : tous refusés.
- Revue de sécurité : validation SSRF renforcée avec contrôle de toutes les réponses DNS, épinglage de l'IP validée et tests unitaires locaux (`npm test`).
- YouTube « Me at the zoo » : infos ✓, vidéo MP4 (H.264 + AAC) ✓, MP3 ✓, fichiers temporaires nettoyés ✓.
- Front ↔ backend local : analyse, choix de qualité, téléchargement, MP3 ✓.
- Thèmes sombre et clair, mobile 375 px (pas de défilement horizontal), menu mobile ✓.
- **Pas testé** : TikTok/Instagram via RapidAPI (pour ne pas consommer ton quota) et le site en production.

## État après le compte rendu
- Les statistiques non vérifiées ont été retirées de la page d'accueil.
- Les miniatures ont une limite séparée (120 requêtes / 10 min) ; les autres routes API gardent leur limite de 20.
- Le formulaire ne prétend plus envoyer le message : il prévient que l'envoi n'est pas configuré et conserve les champs.
- Une PWA Android installable est préparée : interface mise en cache hors ligne et partage direct d'une URL vers SnapLoad. L'analyse et le téléchargement requièrent toujours Internet et le backend.

### Installer SnapLoad sur Android
Après déploiement des fichiers `frontend` sur Netlify, ouvrir le site dans Chrome Android, puis choisir **⋮ → Installer l'application** (ou **Ajouter à l'écran d'accueil**). Une fois installée, SnapLoad apparaît dans le menu de partage Android pour envoyer un lien vidéo directement à l'application. L'analyse et le téléchargement nécessitent toujours une connexion Internet.

## Reste à faire
- Le formulaire est relié à Netlify Forms. La réception réelle des messages doit être vérifiée après le déploiement du frontend sur Netlify.
- Vérifier séparément le déploiement du backend sur Render et du frontend sur Netlify après chaque publication.
