import Link from 'next/link';
import { prisma } from '@/lib/db';
import { gameName, getRankTier, winrate } from '@/lib/game';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
    const activeSeason = await prisma.season.findFirst({ where: { isActive: true }, orderBy: { id: 'desc' } });
    const seasonId = activeSeason?.id ?? null;

    const now = new Date();
    const rushHours = await prisma.event.findMany({
        where: { type: 'rush_hour', startAt: { lte: now }, endAt: { gt: now } },
        orderBy: { endAt: 'asc' },
    });

    // Configured ladders (distinct game+mode) with their top 5
    const configs = await prisma.gameConfig.findMany({
        select: { game: true, mode: true },
        distinct: ['game', 'mode'],
        orderBy: [{ game: 'asc' }, { mode: 'asc' }],
    });

    const ladders = await Promise.all(configs.map(async ({ game, mode }) => ({
        game,
        mode,
        top: await prisma.elo.findMany({
            where: { game, mode, seasonId },
            orderBy: { rating: 'desc' },
            take: 5,
            include: { user: { select: { username: true, id: true } } },
        }),
    })));

    return (
        <>
            <section className="hero">
                <h1>
                    The competitive hub of the <em>ASYLUM</em> community.
                </h1>
                <p>
                    Live ladders, player profiles and match history — synced in real time with the
                    Discord matchmaking bot. {activeSeason ? `Currently running: ${activeSeason.name}.` : 'No active season yet.'}
                </p>
                <div className="hero-actions">
                    <Link className="btn btn-gold" href="/leaderboard/rl">Browse leaderboards</Link>
                    <Link className="btn" href="/me">My profile</Link>
                </div>
            </section>

            {rushHours.length > 0 && (
                <div className="card" style={{ borderColor: 'rgba(199,167,64,.45)' }}>
                    <div className="card-title" style={{ color: 'var(--gold)' }}>Rush hour live</div>
                    {rushHours.map(e => (
                        <div key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <span className="pill pill-gold">×{e.multiplier}</span>
                            <span>{e.game ? gameName(e.game) : 'All games'}</span>
                            <span className="muted">ends at {e.endAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} UTC</span>
                        </div>
                    ))}
                </div>
            )}

            <section style={{ marginTop: 28 }}>
                <div className="grid grid-2">
                    {ladders.filter(l => l.top.length > 0).map(ladder => (
                        <div className="card" key={`${ladder.game}-${ladder.mode}`} style={{ marginTop: 0 }}>
                            <div className="card-title">
                                <Link href={`/leaderboard/${ladder.game}?mode=${ladder.mode}`}>
                                    {gameName(ladder.game)} — {ladder.mode}
                                </Link>
                            </div>
                            <table className="table">
                                <tbody>
                                    {ladder.top.map((row, i) => (
                                        <tr key={row.id}>
                                            <td className={`pos pos-${i + 1}`}>{i + 1}</td>
                                            <td>
                                                <Link href={`/player/${row.userId}`}>{row.user.username}</Link>
                                            </td>
                                            <td className="num" style={{ color: getRankTier(row.rating).color }}>{row.rating}</td>
                                            <td className="num muted">{winrate(row.wins, row.losses)}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
                {ladders.every(l => l.top.length === 0) && (
                    <div className="card empty">No ranked players yet — ladders appear after the first reported matches.</div>
                )}
            </section>
        </>
    );
}
