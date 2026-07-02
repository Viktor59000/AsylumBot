export const COLORS = {
    ASYLUM_GOLD: '#C7A740',
    ASYLUM_DARK: '#0F0F1A',
    SUCCESS: '#00FF00', // Bright Green for Join
    DANGER: '#FF0000',  // Bright Red for Leave
    PRIMARY: '#5865F2', // Discord Blurple for Party/Duo
    WARNING: '#FFA500',
};

export const BOT_ICON = 'https://cdn.discordapp.com/icons/890698223541448714/dd89d7c90b4779547c4b149de6ecdb03.webp?size=1024';

export const GAME_CONFIGS = {
    rl: {
        name: 'Rocket League',
        teamSize: 3,
        thumbnail: BOT_ICON,
        emoji: '⚽',
    },
    cs2: {
        name: 'Counter-Strike 2',
        teamSize: 5,
        thumbnail: BOT_ICON,
        emoji: '🔫',
    },
    r6s: {
        name: 'Rainbow Six Siege',
        teamSize: 5,
        thumbnail: BOT_ICON,
        emoji: '🛡️',
    },
    lol: {
        name: 'League of Legends',
        teamSize: 5,
        thumbnail: BOT_ICON,
        emoji: '⚔️',
    },
    valorant: {
        name: 'Valorant',
        teamSize: 5,
        thumbnail: BOT_ICON,
        emoji: '🎯',
    },
    arena: {
        name: 'LoL Arena',
        teamSize: 8, // 16 players total, but teamSize usually means "Players per Side" in core logic?
        // Wait, core logic is queue.length >= teamSize * 2. 
        // If we want 16 players, teamSize should be 8.
        thumbnail: BOT_ICON,
        emoji: '🏟️',
    },
};

// ---- Multi-mode (Lot 1) ----
// Each game exposes one or more queue modes. A mode = its own queue channel,
// its own Elo ladder (Elo key: userId+game+mode+season) and its own matches.

export interface ModeConfig {
    name: string;      // Display name ("SoloQ", "1v1", ...)
    teamSize: number;  // Players per team (queue pops at teamSize * 2, arena excepted)
}

export const GAME_MODES: Record<string, Record<string, ModeConfig>> = {
    rl: {
        '1v1': { name: '1v1', teamSize: 1 },
        '2v2': { name: '2v2', teamSize: 2 },
        '3v3': { name: '3v3', teamSize: 3 },
    },
    cs2: {
        soloq: { name: 'SoloQ', teamSize: 5 },
    },
    r6s: {
        soloq: { name: 'SoloQ', teamSize: 5 },
    },
    lol: {
        soloq: { name: 'SoloQ', teamSize: 5 },
    },
    valorant: {
        soloq: { name: 'SoloQ', teamSize: 5 },
    },
    arena: {
        soloq: { name: 'Arena', teamSize: 8 }, // 16 players, 8 duos (reworked to 6x3 in Lot 2)
    },
};

/** First declared mode of a game (used as fallback for legacy buttons/commands). */
export const getDefaultMode = (game: string): string => {
    const modes = GAME_MODES[game];
    return modes ? Object.keys(modes)[0] : 'soloq';
};

export const getModeConfig = (game: string, mode: string): ModeConfig | undefined =>
    GAME_MODES[game]?.[mode];

/** Composite key used to index queues/configs: one queue per (game, mode). */
export const queueKey = (game: string, mode: string): string => `${game}:${mode}`;

export const parseQueueKey = (key: string): { game: string; mode: string } => {
    const [game, mode] = key.split(':');
    return { game, mode };
};

/** All distinct mode keys across games (for slash-command choices). */
export const ALL_MODE_KEYS = Array.from(
    new Set(Object.values(GAME_MODES).flatMap(modes => Object.keys(modes)))
);

export const MAP_POOLS = {
    cs2: ['Mirage', 'Nuke', 'Inferno', 'Vertigo', 'Ancient', 'Anubis', 'Dust2'],
    valorant: ['Ascent', 'Bind', 'Haven', 'Split', 'Lotus', 'Sunset', 'Abyss'],
    r6s: ['Clubhouse', 'Consulate', 'Chalet', 'Kafe', 'Border', 'Skyscraper', 'Oregon', 'Bank', 'Nighthaven Labs'],
};

export const EMOJIS = {
    LOADING: '⏳',
    SUCCESS: '✅',
    ERROR: '❌',
    WARNING: '⚠️',
};
