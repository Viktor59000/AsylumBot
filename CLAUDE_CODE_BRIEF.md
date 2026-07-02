# BRIEF D'EXÉCUTION — AsylumBot « version finale » (pour Claude Code / Codex)

> **Comment l'utiliser :** ouvre le projet dans Claude Code et donne-lui :
> « Lis `CLAUDE_CODE_BRIEF.md`, `AUDIT_ASYLUMBOT.md`, `TASKS.md` et `DESIGN_ULTIME.md`. Exécute les lots dans l'ordre. Commence par le **Lot 0**. Après chaque lot : `npx tsc --noEmit` doit passer, commit sur une branche dédiée, et tu t'arrêtes pour que je teste avant le lot suivant. »

---

## 0. Contexte

Bot Discord d'inhouse multi-jeux (discord.js v14 + Prisma). Les bugs bloquants (P0) sont **déjà corrigés** (le cycle file → match → report → re-queue fonctionne). Ta mission : construire la **version finale** décrite dans `DESIGN_ULTIME.md`, en suivant l'ordre de `TASKS.md`, sans casser l'existant.

Trois documents font foi :
- `AUDIT_ASYLUMBOT.md` — état du code, bugs, dette.
- `TASKS.md` — checklist P0→P3 (P0 = fait).
- `DESIGN_ULTIME.md` — cible produit (jeux, modes, UX, events, site).

## 1. Règles d'or (NON négociables)

1. **Ne casse pas les P0.** Le cycle file → ready-check → vote → lobby → report → nettoyage → re-queue doit rester fonctionnel après chaque lot.
2. **Un seul `PrismaClient`** : toujours `import { prisma } from '.../utils/db'`. Jamais `new PrismaClient()` ailleurs.
3. **Toute évolution de schéma = migration Prisma** (`npx prisma migrate dev --name <desc>` puis `npx prisma generate`). Ne jamais éditer la base à la main.
4. **`npx tsc --noEmit` doit passer** avant chaque commit. Zéro erreur de type.
5. **Managers = singletons** initialisés une fois au `ready`. Interdiction de faire `new XxxManager()` dans un handler de commande (fuite de timers — cf. `ChallengeManager`).
6. **Aucun secret commité** (`.env` est gitignore). Utiliser `.env.example` comme référence.
7. **Une branche par lot**, commits atomiques, messages clairs. Tu t'arrêtes en fin de lot pour test humain.
8. **i18n** : toute nouvelle chaîne visible passe par `utils/i18n` (FR/EN).
9. **Style** : garde la charte (`COLORS.ASYLUM_GOLD`), embeds propres, tout au **bouton** côté joueur (principe « zéro-admin après setup », cf. DESIGN §6.4).

## 2. Pièges connus (à traiter explicitement)

- **État live en mémoire** (files, ready-checks, votes, drafts, vetos, lobbies) : perdu au redémarrage. Prévoir la **récupération au boot** (P1-2) : reset des statuts bloqués, nettoyage des salons/matchs orphelins.
- **État indexé par `game`** dans `ReadyCheckManager`, `VoteManager`, `DraftManager`, `VetoManager` : avec le multi-mode, **plusieurs matchs du même jeu** peuvent tourner en parallèle → ré-indexer par **session de match** (id unique) ou `(game, mode, matchId)`, pas par `game`.
- **Elo partagé** : aujourd'hui clé `(userId, game, saison)`. Les formats à Elo distinct (RL 1v1/2v2/3v3, TFT Solo/DoubleUp) imposent `(userId, game, mode, saison)`.
- **`seasonId: null` codé en dur** partout : brancher la **saison active** réelle (créer/lire une `Season isActive`).
- **Deux moteurs de résultat** : `tvt` (gagnant/perdant) vs `placement` (classement 1→N pour Arena & TFT). Introduire `matchType` + report + formule d'Elo par type (DESIGN §1bis).
- **Intents** : retirer `MessageContent` (inutilisé) ; garder `GuildMembers` + `GuildVoiceStates` (nécessaires). Activer les intents privilégiés requis côté portail.
- **`/setup` cherche les salons par nom** → tester sur un **serveur Discord vierge** (sinon d'anciens salons faussent le résultat).
- **Nettoyage des salons** : passe par `LobbyManager.cleanupMatch` (déjà en place) ; pour un cleanup fiable après restart, persister `textChannelId` + tous les vocaux dans `Match` (migration).

## 3. Ordre d'exécution (lots)

### Lot 0 — Stabilité 24/7 & fondations techniques (TASKS P1)
- P1-1 **Migration SQLite → PostgreSQL** (`provider = "postgresql"`, régénérer migrations). *Pré-requis du multi-process bot + site.*
- P1-2 Récupération au boot (statuts, matchs/salons orphelins).
- P1-3 Managers singletons (corrige la fuite de timers).
- P1-4 Handlers globaux d'erreurs + arrêt gracieux (`unhandledRejection`, `SIGTERM` → `prisma.$disconnect()`).
- P1-5 Timers annulables + cron idempotent (challenges).
- P1-6 `await` sur toutes les mutations de statut.
- P1-7 Retirer l'intent `MessageContent`.
- P1-8 Auto-update du message de file permanent (event `queueUpdate` + `queueMessageId`, throttle ~2 s).
- **DoD** : bot redémarre proprement sans état incohérent ; `tsc` vert.

### Lot 1 — Multi-mode + salons dédiés (DESIGN §2)
- `GameConfig` clé **(guildId, game, mode)** ; un `queueChannelId` par mode.
- `/setup` : sélection multi-mode → crée un salon de file par mode activé.
- Elo clé **(userId, game, mode, saison)**.
- Ré-indexer ready-check/vote/draft/veto par session (cf. §2).
- **Réparer & finaliser le Party/Duo invite** (actuellement cassé) : bouton → sélection du joueur → accept → le groupe est **gardé ensemble** par le matchmaking (base du mode DuoQ). Diagnostiquer le flux `invite_party_` / `select_party_member_` / `accept_invite_` dans `queue.ts` + routage `index.ts`.
- **DoD** : deux modes du même jeu tournent en parallèle sans collision ; un duo invité se retrouve dans la même équipe.

### Lot 2 — Roster de jeux complet (DESIGN §1 + §1bis)
- Rocket League : modes **1v1 / 2v2 / 3v3** (salons + Elo séparés).
- LoL **Arena en 6 équipes de 3** (18 joueurs, 6 vocaux, report par classement 1→6).
- **TFT** : Solo (FFA 8, classement 1→8) + Double Up (4×2, classement 1→4).
- `matchType` (`tvt`/`placement`) + report par placement + Elo par placement (migration : `MatchPlayer.placement` ou table `MatchPlacement`).
- **DoD** : chaque jeu/mode se setup, pop, et reporte correctement (binaire ou placement).

### Lot 3 — Matchmaking réel (DESIGN §4)
- Équilibrage **par Elo** (fini le random pur) respectant les **groupes/duos** indivisibles.
- Écrire `winStreak` / `highestRating`.
- **DoD** : équipes équilibrées, écart d'Elo affiché, duos jamais séparés.

### Lot 4 — Refonte UX (DESIGN §6)
- **Salon de file** : embed live (bannière, compteur X/N + barre, chaque joueur avec **rôle déclaré** + **rang/Elo** + marqueur duo + **présence vocale 🔊**), auto-rafraîchi.
- **Ready-check vocal-gated** + Waiting Room + no-show → pénalité (DESIGN §6.5).
- **Lobby** : 2 équipes avec rôles/rangs/couleurs, liens, écart d'Elo.
- **Report par boutons sécurisé** (participant only, confirmation croisée ou capitaine/admin, fenêtre de contestation) + écriture dans `#match-history` + logs admin.
- Bannières complètes par jeu/mode/événement.
- **DoD** : un joueur fait tout au bouton, aucune slash-command requise pour jouer.

### Lot 5 — Engagement (DESIGN §5)
- Rush hours (multiplicateur Elo/coins + annonces), saisons complètes (`/season start`, reset paramétrable, récompenses), challenges étendus, leaderboards live (message édité) + badges/rangs visuels.
- **DoD** : événements planifiables, récompenses distribuées, ladder auto-actualisé.

### Lot 6 — Site web (DESIGN §7)
- Next.js (App Router) + **Discord OAuth2** + **base partagée** (Prisma/Postgres).
- Pages : `/`, `/leaderboard/[game]`, `/player/[id]`, `/match/[id]`, `/clan/[name]`, `/me`.
- Liens Discord ↔ web via le Discord ID commun.
- **DoD** : ladder + profils consultables, login Discord fonctionnel.

## 4. Definition of Done globale
- `npx tsc --noEmit` = 0 erreur.
- Cycle complet testé sur **serveur vierge** pour chaque jeu/mode touché.
- Aucun `new PrismaClient()` hors `utils/db`.
- Pas de régression du flux P0.
- Migrations Prisma présentes et appliquées.
- README + `.env.example` à jour.

## 5. Détails d'implémentation
Pour chaque item, le **quoi/pourquoi/où** précis est déjà dans `TASKS.md` (P1/P2/P3) et `DESIGN_ULTIME.md` (specs). En cas de doute d'archi, suivre `DESIGN_ULTIME.md` ; en cas de doute sur un bug existant, suivre `AUDIT_ASYLUMBOT.md`.
