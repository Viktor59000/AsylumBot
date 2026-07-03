import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { GAME_NAMES, gameName, getRankTier, winrate } from '@/lib/game';
import { RankBadge } from '@/components/RankBadge';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

interface Props {
    params: { game: string };
    searchParams: { mode?: string; season?: string; page?: string };
}

export default async function LeaderboardPage({ params, searchParams }: Props) {
    const game = params.game;
    if (!GAME_NAMES[game]) notFound();

    // Available modes for this game (from configs, fallback to elo rows)
    const configs = await prisma.gameConfig.findMany({
        where: { game },
        select: { mode: true },
        distinct: ['mode'],
        orderBy: { mode: 'asc' },
    });
    const modes = configs.length > 0
        ? configs.map(c => c.mode)
        : (await prisma.elo.findMany({ where: { game }, select: { mode: true }, distinct: ['mode'] })).map(e => e.mode);

    const mode = searchParams.mode && modes.includes(searchParams.mode) ? searchParams.mode : modes[0];

    // Seasons: active first, then archives
    const seasons = await prisma.season.findMany({ orderBy: { id: 'desc' } });
    const activeSeason = seasons.find(s => s.isActive) ?? null;
    const requestedSeasonId = searchParams.season ? parseInt(searchParams.season, 10) : undefined;
    const season = requestedSeasonId !== undefined
        ? seasons.find(s => s.id === requestedSeasonId) ?? activeSeason
        : activeSeason;
    const seasonId = season?.id ?? null;

    const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
    const where = { game, mode: mode ?? '', seasonId };

    const [rows, total] = await Promise.all([
        prisma.elo.findMany({
            where,
            orderBy: { rating: 'desc' },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
            include: { user: { select: { username: true } } },
        }),
        prisma.elo.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const href = (overrides: { mode?: string; season?: number | 'active'; page?: number }) => {
        const q = new URLSearchParams();
        const m = overrides.mode ?? mode;
        if (m) q.set('mode', m);
        const s = overrides.season === 'active' ? activeSeason?.id : overrides.season ?? season?.id;
        if (s !== undefined && s !== activeSeason?.id) q.set('season', String(s));
        const p = overrides.page ?? 1;
        if (p > 1) q.set('page', String(p));
        const qs = q.toString();
        return `/leaderboard/${game}${qs ? `?${qs}` : ''}`;
    };

    return (
        <>
            <div className="page-head">
                <h1>{gameName(game)}</h1>
                <span className="muted">{season ? season.name : 'Pre-season'} — {total} ranked player{total === 1 ? '' : 's'}</span>
            </div>

            <div className="filters">
                {modes.map(m => (
                    <Link key={m} className={`pill ${m === mode ? 'pill-active' : ''}`} href={href({ mode: m, page: 1 })}>
                        {m}
                    </Link>
                ))}
                <span style={{ width: 12 }} />
                {seasons.map(s => (
                    <Link key={s.id} className={`pill ${s.id === season?.id ? 'pill-active' : ''}`} href={href({ season: s.id, page: 1 })}>
                        {s.name}{s.isActive ? ' — live' : ''}
                    </Link>
                ))}
            </div>

            <div className="card" style={{ padding: 0 }}>
                {rows.length === 0 ? (
                    <div className="empty">No ranked players on this ladder yet.</div>
                ) : (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Player</th>
                                <th>Tier</th>
                                <th>Rating</th>
                                <th>W / L</th>
                                <th>Winrate</th>
                                <th>Streak</th>
                                <th>Peak</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, i) => {
                                const rank = (page - 1) * PAGE_SIZE + i + 1;
                                return (
                                    <tr key={row.id}>
                                        <td className={`pos pos-${rank <= 3 ? rank : ''}`}>{rank}</td>
                                        <td><Link href={`/player/${row.userId}`}>{row.user.username}</Link></td>
                                        <td><RankBadge rating={row.rating} /></td>
                                        <td className="num" style={{ color: getRankTier(row.rating).color, fontWeight: 700 }}>{row.rating}</td>
                                        <td className="num muted">{row.wins} / {row.losses}</td>
                                        <td style={{ minWidth: 120 }}>
                                            <div className="bar"><i style={{ width: `${winrate(row.wins, row.losses)}%` }} /></div>
                                            <span className="muted mono" style={{ fontSize: 12 }}>{winrate(row.wins, row.losses)}%</span>
                                        </td>
                                        <td className="num">{row.winStreak > 0 ? `+${row.winStreak}` : '—'}</td>
                                        <td className="num muted">{row.highestRating}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {totalPages > 1 && (
                <div className="filters" style={{ marginTop: 18 }}>
                    {page > 1 && <Link className="pill" href={href({ page: page - 1 })}>Previous</Link>}
                    <span className="pill">Page {page} / {totalPages}</span>
                    {page < totalPages && <Link className="pill" href={href({ page: page + 1 })}>Next</Link>}
                </div>
            )}
        </>
    );
}
