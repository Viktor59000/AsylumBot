// Tracker deep-links built from the IGN alone — no API, no scraping (DESIGN §3bis).

export interface TrackerLink {
    label: string;
    url: string;
}

const enc = encodeURIComponent;

/** Splits a Riot ID "Name#Tag" → [Name, Tag] (tag may be missing). */
const riotId = (ign: string): [string, string] => {
    const idx = ign.indexOf('#');
    return idx === -1 ? [ign, ''] : [ign.slice(0, idx), ign.slice(idx + 1)];
};

/**
 * Deep-links to public tracker profiles for a given game + IGN.
 * `region` comes from the guild's GameConfig (defaults to EUW).
 */
export function getTrackerLinks(game: string, ign: string, region: string = 'EUW'): TrackerLink[] {
    const reg = region.toLowerCase();
    const [name, tag] = riotId(ign);

    switch (game) {
        case 'lol':
        case 'arena':
            return [
                { label: 'OP.GG', url: `https://www.op.gg/summoners/${enc(reg)}/${enc(name)}-${enc(tag || reg.toUpperCase())}` },
                { label: 'U.GG', url: `https://u.gg/lol/profile/${enc(reg)}1/${enc(name)}-${enc(tag || reg.toUpperCase())}/overview` },
            ];
        case 'valorant':
            return [
                { label: 'Tracker.gg', url: `https://tracker.gg/valorant/profile/riot/${enc(`${name}#${tag}`)}/overview` },
            ];
        case 'tft':
            return [
                { label: 'tactics.tools', url: `https://tactics.tools/player/${enc(reg)}/${enc(name)}/${enc(tag || reg.toUpperCase())}` },
                { label: 'MetaTFT', url: `https://www.metatft.com/player/${enc(reg)}/${enc(name)}-${enc(tag || reg.toUpperCase())}` },
            ];
        case 'rl':
            return [
                { label: 'RL Tracker (recherche)', url: `https://rocketleague.tracker.network/rocket-league/search?query=${enc(ign)}` },
            ];
        case 'cs2':
            return [
                { label: 'CSStats (recherche)', url: `https://csstats.gg/search?q=${enc(ign)}` },
                { label: 'Leetify', url: `https://leetify.com/` },
            ];
        case 'r6s':
            return [
                { label: 'R6 Tracker (recherche)', url: `https://r6.tracker.network/r6siege/search?name=${enc(ign)}&platform=ubi` },
            ];
        default:
            return [];
    }
}

/** Markdown line "[OP.GG](url) • [U.GG](url)" — empty string if no tracker. */
export function formatTrackerLinks(game: string, ign: string, region?: string): string {
    return getTrackerLinks(game, ign, region).map(l => `[${l.label}](${l.url})`).join(' • ');
}
