import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { gameName, getRankTier, winrate } from '@/lib/game';
import { RankBadge } from '@/components/RankBadge';
import { Avatar } from '@/components/Avatar';

export const dynamic = 'force-dynamic';

export default async function PlayerPage({ params }: { params: { id: string } }) {
    const user = await prisma.user.findUnique({
        where: { id: params.id },
        include: { clan: true },
    });
    if (!user) notFound();

    const activeSeason = await prisma.season.findFirst({ where: { isActive: true }, orderBy: { id: 'desc' } });
    const seasonId = activeSeason?.id ?? null;

    const [activeElos, historyElos, badges, recentMatches] = await Promise.all([
        prisma.elo.findMany({
            where: { userId: user.id, seasonId },
            orderBy: [{ game: 'asc' }, { mode: 'asc' }],
        }),
        prisma.elo.findMany({
            where: { userId: user.id, NOT: { seasonId } },
            include: { season: true },
            orderBy: { id: 'desc' },
            take: 12,
        }),
        prisma.userBadge.findMany({
            where: { userId: user.id },
            include: { badge: true },
            orderBy: { awardedAt: 'desc' },
        }),
        prisma.matchPlayer.findMany({
            where: { userId: user.id, match: { status: 'reported' } },
            include: { match: true },
            orderBy: { matchId: 'desc' },
            take: 10,
        }),
    ]);

    return (
        <>
            <div className="page-head" style={{ alignItems: 'center' }}>
                <Avatar name={user.username} />
                <h1>{user.username}</h1>
                {user.clan && (
                    <Link className="pill pill-gold" href={`/clan/${encodeURIComponent(user.clan.name)}`}>
                        {user.clan.name}
                    </Link>
                )}
                <span className="muted mono" style={{ fontSize: 12 }}>Discord ID {user.id}</span>
            </div>

            {badges.length > 0 && (
                <div className="filters">
                    {badges.map(ub => (
                        <span key={ub.id} className="pill" title={ub.badge.description ?? ''}>
                            {ub.badge.name}
                            {ub.game ? ` — ${gameName(ub.game)}${ub.mode ? ` ${ub.mode}` : ''}` : ''}
                        </span>
                    ))}
                </div>
            )}

            <div className="card" style={{ padding: 0 }}>
                <div className="card-title" style={{ padding: '18px 18px 0' }}>
                    {activeSeason ? `${activeSeason.name} — current ladders` : 'Current ladders'}
                </div>
                {activeElos.length === 0 ? (
                    <div className="empty">No ranked games this season yet.</div>
                ) : (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Ladder</th>
                                <th>Tier</th>
                                <th>Rating</th>
                                <th>W / L</th>
                                <th>Winrate</th>
                                <th>Streak</th>
                                <th>Peak</th>
                            </tr>
                        </thead>
                        <tbody>
                            {activeElos.map(elo => (
                                <tr key={elo.id}>
                                    <td>
                                        <Link href={`/leaderboard/${elo.game}?mode=${elo.mode}`}>
                                            {gameName(elo.game)} — {elo.mode}
                                        </Link>
                                    </td>
                                    <td><RankBadge rating={elo.rating} /></td>
                                    <td className="num" style={{ color: getRankTier(elo.rating).color, fontWeight: 700 }}>{elo.rating}</td>
                                    <td className="num muted">{elo.wins} / {elo.losses}</td>
                                    <td className="num">{winrate(elo.wins, elo.losses)}%</td>
                                    <td className="num">{elo.winStreak > 0 ? `+${elo.winStreak}` : '—'}</td>
                                    <td className="num muted">{elo.highestRating}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="grid grid-2" style={{ marginTop: 18 }}>
                <div className="card" style={{ marginTop: 0, padding: 0 }}>
                    <div className="card-title" style={{ padding: '18px 18px 0' }}>Recent matches</div>
                    {recentMatches.length === 0 ? (
                        <div className="empty">No reported matches yet.</div>
                    ) : (
                        <table className="table">
                            <tbody>
                                {recentMatches.map(mp => {
                                    const isPlacement = mp.match.matchType === 'placement';
                                    const won = isPlacement ? (mp.placement ?? 99) === 1 : mp.match.winner === mp.team;
                                    const label = isPlacement
                                        ? (mp.placement ? `#${mp.placement}` : '—')
                                        : (won ? 'Win' : 'Loss');
                                    return (
                                        <tr key={`${mp.matchId}-${mp.userId}`}>
                                            <td className="muted mono">#{mp.matchId}</td>
                                            <td>{gameName(mp.match.game)} — {mp.match.mode}</td>
                                            <td className={won ? 'result-win' : isPlacement ? '' : 'result-loss'}>{label}</td>
                                            <td className="muted" style={{ fontSize: 12 }}>
                                                {mp.match.createdAt.toLocaleDateString('en-GB')}
                                            </td>
                                            <td><Link className="pill" href={`/match/${mp.matchId}`}>Details</Link></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="card" style={{ marginTop: 0, padding: 0 }}>
                    <div className="card-title" style={{ padding: '18px 18px 0' }}>Season history</div>
                    {historyElos.filter(e => e.season).length === 0 ? (
                        <div className="empty">No archived seasons yet.</div>
                    ) : (
                        <table className="table">
                            <tbody>
                                {historyElos.filter(e => e.season).map(elo => (
                                    <tr key={elo.id}>
                                        <td>{elo.season!.name}</td>
                                        <td className="muted">{gameName(elo.game)} — {elo.mode}</td>
                                        <td className="num" style={{ color: getRankTier(elo.rating).color }}>{elo.rating}</td>
                                        <td className="num muted">{elo.wins}W – {elo.losses}L</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </>
    );
}
