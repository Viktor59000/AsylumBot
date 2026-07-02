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
