# 🤖 ASYLUM-BOT

**ASYLUM-BOT** is a powerful competitive matchmaking and Elo tracking bot designed for the **ASYLUM ELO HUB**. It manages queues, tracks player statistics, handles clan systems, and automates voice channels for a seamless competitive experience.

## 🎮 Supported Games

The bot currently supports Elo tracking and matchmaking for:
*   🚀 **Rocket League**
*   🔫 **Counter-Strike 2**
*   🛡️ **Rainbow Six Siege**
*   ⚔️ **League of Legends** (with DraftLoL & OP.GG Integration)
*   🎯 **Valorant** (with Tracker.gg Integration)

---

## ✨ Key Features

### 🏆 Elo & Ranking System
*   **Skill Tracking**: Advanced Elo rating system (starting at 1000).
*   **Ranks**: Progression from Bronze to Diamond based on Elo.
*   **Season History**: Tracks performance across different seasons.
*   **Leaderboards**: Global leaderboards for each game.

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

#### Queue & Matchmaking
*   `/queue join <game>`: Join the matchmaking queue.
*   `/queue leave`: Leave your current queue.
*   `/queue status`: View the current status of all queues.

#### Party Management
*   `/party invite <user>`: Invite a player to your party.
*   `/party kick <user>`: Kick a player from your party.
*   `/party leave`: Leave your current party.
*   `/party promote <user>`: Promote a member to party leader.

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
*   `/config <game> [teamsize] [queue_banner] [win_banner]`: Configure game settings and banners.
*   `/admin add_elo <user> <game> <amount>`: Manually add Elo to a player.
*   `/admin remove_elo <user> <game> <amount>`: Manually remove Elo from a player.
*   `/admin reset_elo <user> <game>`: Reset a player's Elo to default (1000).

#### Moderation & Match Management
*   `/game sub <match_id> <old_user> <new_user>`: Substitute a player in an active match.
*   `/game cancel <match_id>`: Cancel a match without Elo loss.
*   `/queue suspend <user> <duration> <reason>`: Temporarily ban a user from the queue.

---

## 🚀 Getting Started

1.  **Select Your Roles**: Use `/role_menu` to choose the games you play.
2.  **Join a Queue**: Use `/queue join` or click the buttons in the setup channel.
3.  **Vote for Mode**: When the queue pops, vote for Ranked, Captains, or Casual.
4.  **Play & Report**: Play your match. (Match reporting is handled via buttons/commands in the match channel).
5.  **Climb the Ranks**: Win games to gain Elo and rise on the leaderboard!

---

*Developed for ASYLUM ELO HUB.*
