import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { gameName } from '@/lib/game';

export const dynamic = 'force-dynamic';

const teamClass = (team: string, matchType: string) => {
    if (matchType === 'placement') return 'team-neutral';
    return team === 'team1' ? 'team-blue' : 'team-red';
};

export default async function MatchPage({ params }: { params: { id: string } }) {
    const matchId = parseInt(params.id, 10);
    if (isNaN(matchId)) notFound();

    const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
            players: { include: { user: { select: { username: true } } } },
            season: true,
        },
    });
    if (!match) notFound();

    const isPlacement = match.matchType === 'placement';

    // Group players by team, ordered by placement (placement) or team key (tvt)
    const teams = new Map<string, typeof match.players>();
    for (const player of match.players) {
        if (!teams.has(player.team)) teams.set(player.team, []);
        teams.get(player.team)!.push(player);
    }
    const orderedTeams = Array.from(teams.entries()).sort((a, b) => {
        const pa = a[1][0]?.placement ?? 99;
        const pb = b[1][0]?.placement ?? 99;
        if (isPlacement) return pa - pb;
        return a[0].localeCompare(b[0]);
    });

    const statusPill =
        match.status === 'reported' ? <span className="pill pill-gold">Reported</span> :
        match.status === 'live' ? <span className="pill pill-active">Live</span> :
        <span className="pill">{match.status}</span>;

    return (
        <>
            <div className="page-head">
                <h1>Match #{match.id}</h1>
                {statusPill}
                <span className="muted">
                    {gameName(match.game)} — {match.mode}
                    {match.season ? ` — ${match.season.name}` : ''}
                    {match.map ? ` — ${match.map}` : ''}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                    {match.createdAt.toLocaleString('en-GB')}
                </span>
            </div>

            <div className="grid grid-2">
                {orderedTeams.map(([teamKey, players]) => {
                    const placement = players[0]?.placement ?? null;
                    const isWinner = isPlacement ? placement === 1 : match.winner === teamKey;
                    return (
                        <div className="card" key={teamKey} style={{ marginTop: 0, borderColor: isWinner ? 'rgba(199,167,64,.5)' : undefined }}>
                            <div className="card-title" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <span className={`team-chip ${teamClass(teamKey, match.matchType)}`}>
                                    {teamKey.replace('team', 'Team ')}
                                </span>
                                {isPlacement && placement && <span className="pill">Finished #{placement}</span>}
                                {isWinner && <span className="pill pill-gold">Winner</span>}
                            </div>
                            <table className="table">
                                <tbody>
                                    {players.map(p => (
                                        <tr key={p.userId}>
                                            <td><Link href={`/player/${p.userId}`}>{p.user.username}</Link></td>
                                            {p.role && <td className="muted">{p.role}</td>}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
