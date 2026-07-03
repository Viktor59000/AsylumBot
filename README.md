# 🤖 ASYLUM-BOT

**ASYLUM-BOT** is a powerful competitive matchmaking and Elo tracking bot designed for the **ASYLUM ELO HUB**. It manages queues, tracks player statistics, handles clan systems, and automates voice channels for a seamless competitive experience.

## 🎮 Supported Games & Modes

The bot supports Elo tracking and matchmaking per **(game, mode)** — each enabled mode gets its own queue channel and its own Elo ladder:
*   🚀 **Rocket League** — `1v1`, `2v2`, `3v3` (separate Elo per mode)
*   🔫 **Counter-Strike 2** — `soloq`
*   🛡️ **Rainbow Six Siege** — `soloq`
*   ⚔️ **League of Legends** — `soloq` (with OP.GG Integration)
*   🎯 **Valorant** — `soloq`
*   🏟️ **LoL Arena** — `6x3`: 6 teams of 3 (18 players), **placement** match ranked 1→6
*   ♟️ **Teamfight Tactics** — `solo` (FFA 8, ranked 1→8) and `doubleup` (4 duos, ranked 1→4), **placement**

`/setup` lets you pick which modes to enable per game (multi-select). Several matches of the same game can run in parallel across modes.

**Two result engines** (`matchType`):
*   `tvt` — two teams, binary winner → **buttons in the match lobby**: one team claims, the opposing team confirms (or contests → admins notified). `/reportwin` remains as admin fallback.
*   `placement` — N teams ranked 1→N → **position select in the match lobby**: each team picks its final position, auto-validates when complete (admin can force a partial). `/reportplacement` remains as admin fallback. Elo scales with placement vs the field; placement modes skip the team-formation vote.

Results are posted to `#match-history` and logged to `#inhouse-admin-logs`.

**Anti-AFK (opt-in per game/mode)**: `/config voice_gate:true` requires being in a voice channel (e.g. the 🔊 Waiting Room created by `/setup`) to accept the ready-check; players already in voice are auto-moved to their team channel at match start; declining/ignoring a ready-check applies an escalating queue-ban (5 → 15 → 30 min).

**Tracker links**: `/ign` replies with deep-links to OP.GG/U.GG (LoL), Tracker.gg (Valorant), tactics.tools/MetaTFT (TFT), RL Tracker & co — built from the IGN, no API key needed.

---

## ✨ Key Features

### 🏆 Elo & Ranking System
*   **Skill Tracking**: Advanced Elo rating system (starting at 1000), per (game, mode, season).
*   **Ranks**: Progression from Bronze to Diamond based on Elo (visual tiers on leaderboards).
*   **Seasons**: real season lifecycle (`/season start` → matches/Elo linked to the active season → `/season end` with podium badges & coins, optional soft reset).
*   **Leaderboards**: permanent auto-edited leaderboard message per (game, mode).
*   **Engagement**: 🔥 rush hours (multiplied gains, auto-announced), daily + weekly challenges, first-win-of-the-day bonus per game, badges (`/stats`).

### ⚔️ Unified Queue & Voting System
*   **Unified Queue**: All players join a single queue per game.
*   **Voting Phase**: Once the queue is full (10 players), a voting phase begins.
*   **Modes**: Players vote for:
    *   ⚖️ **Balanced (Ranked)**: Teams balanced by Elo.
    *   👑 **Captains (Draft)**: Captains pick their teammates.
    *   🎲 **Random (Casual)**: Teams randomized (unranked).
*   **Auto-Voice Channels**: Automatically creates temporary voice channels for matches.

### 🛡️ Clan System
*   **Clan Creation**: Create your own clan with a custom name and image.
*   **Management**: Invite members, kick players, and update clan details.
*   **Clan Stats**: Track total clan Elo and games played.
*   **Clan Leaderboard**: Compete against other clans for dominance.

### 📊 Player Statistics
*   **Comprehensive Profile**: View your general stats (Total Elo, Games) and detailed per-game stats.
*   **Visuals**: Displays your avatar and clan banner.
*   **Game History**: View your past match results.

---

## 📝 Command List

### 👤 Player Commands

#### Stats & Info
*   `/stats [member]`: View detailed statistics for yourself or another player.
*   `/leaderboard <game>`: View the top 10 players for a specific game.
*   `/role_menu`: Open the Role Picker to select your games and roles.

#### Profile
*   `/ign <game> <pseudo>`: Register your in-game name (required before queuing).
*   `/set-profile`: Guided wizard (IGN + role preferences).

#### Queue & Matchmaking
*   Joining/leaving the queue and party invites are done with the **buttons** on the permanent queue message (auto-updated).
*   `/queue view <game>`: Post a queue embed with Join/Leave/Invite buttons.
*   `/queue force_leave`: Emergency reset if you are stuck in a queue.

### 🛡️ Clan Commands

*   `/clan create <name> [image]`: Create a new clan.
*   `/clan update [name] [image]`: Update your clan's name or image (Leader only).
*   `/clan invite <user>`: Invite a user to your clan.
*   `/clan kick <user>`: Kick a member from your clan.
*   `/clan leave`: Leave your current clan.
*   `/clan info [name]`: View stats for a specific clan (or your own).
*   `/clan list`: View the global clan leaderboard.

### 🔧 Admin Commands

#### Setup & Config
*   `/setup`: Initialize the bot (creates categories, roles, and channels).
*   `/config`: Configure game settings, banners and the voice gate.
*   `/mmr <user> <game> <action> <amount>`: Manually adjust a player's Elo.
*   `/season start <name> [soft_reset]`: Start a new active season (soft reset seeds ratings halfway back to 1000).
*   `/season end`: End the season — podium badges + coins per (game, mode) ladder, stats archived.
*   `/event rushhour <duration> [multiplier] [game] [start_in]`: Schedule a 🔥 rush hour (Elo gains & challenge coins multiplied, auto-announced). `/event list`, `/event cancel`.

#### Moderation & Match Management
*   `/reportwin <match_id> <winning_team>`: Report a team-vs-team match result.
*   `/reportplacement <match_id> <ranking>`: Report a placement match (e.g. `ranking:3,1,4,2`, partial allowed).
*   `/sub <match_id> <old_user> <new_user>`: Substitute a player in an active match.
*   `/cancel <match_id>`: Cancel a match without Elo loss.
*   `/suspend <user> <duration> <reason>`: Temporarily ban a user from the queue.
*   `/queue force_start <game>`: Force a queue to pop with the current players.

---

## 🛠️ Installation & Development

1.  **Prerequisites**: Node.js 18+, a **PostgreSQL** database (required — the bot and the upcoming stats website share it).
    Local quick start: `docker run -d --name asylum-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=asylumbot -p 5432:5432 postgres:16`
2.  **Configure**: copy `.env.example` to `.env` and fill in the values (`DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `DATABASE_URL`, optional `PLAYER_ROLE_ID`).
3.  **Install & migrate**: `npm install`, then `npx prisma migrate deploy` (applies the schema), then `npx prisma generate`.
4.  **Run**: `npm run dev`.

**Deployment (Railway)**: run the bot as a worker and attach the managed PostgreSQL plugin; set `DATABASE_URL` to the plugin URL. The bot is crash-safe: on startup it resets stuck player statuses, abandons unreported matches and deletes orphaned match channels.

> Note: Valorant Tracker.gg integration is **not implemented yet** (planned).

---

## 🚀 Getting Started

1.  **Select Your Roles**: Use `/role_menu` to choose the games you play.
2.  **Join a Queue**: Use `/queue join` or click the buttons in the setup channel.
3.  **Vote for Mode**: When the queue pops, vote for Ranked, Captains, or Casual.
4.  **Play & Report**: Play your match. (Match reporting is handled via buttons/commands in the match channel).
5.  **Climb the Ranks**: Win games to gain Elo and rise on the leaderboard!

---

*Developed for ASYLUM ELO HUB.*
