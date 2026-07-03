// Display metadata shared with the bot's constants (kept in sync manually —
// the source of truth for gameplay values remains src/utils/constants.ts).

export const GAME_NAMES: Record<string, string> = {
    rl: 'Rocket League',
    cs2: 'Counter-Strike 2',
    r6s: 'Rainbow Six Siege',
    lol: 'League of Legends',
    valorant: 'Valorant',
    arena: 'LoL Arena',
    tft: 'Teamfight Tactics',
};

export const gameName = (key: string) => GAME_NAMES[key] ?? key;

export interface RankTier {
    name: string;
    color: string;
}

export const getRankTier = (rating: number): RankTier => {
    if (rating < 1200) return { name: 'Bronze', color: '#b07b4f' };
    if (rating < 1400) return { name: 'Silver', color: '#b9c2cf' };
    if (rating < 1600) return { name: 'Gold', color: '#e8c766' };
    if (rating < 1800) return { name: 'Platinum', color: '#6fc3df' };
    return { name: 'Diamond', color: '#b48fff' };
};

export const winrate = (wins: number, losses: number) =>
    wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
