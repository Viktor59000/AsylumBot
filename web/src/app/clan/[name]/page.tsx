import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { gameName, getRankTier } from '@/lib/game';
import { Avatar } from '@/components/Avatar';

export const dynamic = 'force-dynamic';

export default async function ClanPage({ params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const clan = await prisma.clan.findUnique({
        where: { name },
        include: { members: true },
    });
    if (!clan) notFound();

    const activeSeason = await prisma.season.findFirst({ where: { isActive: true }, orderBy: { id: 'desc' } });
    const seasonId = activeSeason?.id ?? null;

    const memberIds = clan.members.map(m => m.id);
    const elos = memberIds.length > 0
        ? await prisma.elo.findMany({ where: { userId: { in: memberIds }, seasonId } })
        : [];

    const totalElo = elos.reduce((s, e) => s + e.rating, 0);
    const totalGames = elos.reduce((s, e) => s + e.wins + e.losses, 0);
    const bestByMember = new Map<string, { rating: number; game: string; mode: string }>();
    for (const elo of elos) {
        const best = bestByMember.get(elo.userId);
        if (!best || elo.rating > best.rating) {
            bestByMember.set(elo.userId, { rating: elo.rating, game: elo.game, mode: elo.mode });
        }
    }

    const members = [...clan.members].sort((a, b) =>
        (bestByMember.get(b.id)?.rating ?? 0) - (bestByMember.get(a.id)?.rating ?? 0));

    return (
        <>
            <div className="page-head" style={{ alignItems: 'center' }}>
                <Avatar name={clan.name} />
                <h1>{clan.name}</h1>
                <span className="muted">Founded {clan.createdAt.toLocaleDateString('en-GB')}</span>
            </div>

            <div className="grid grid-3">
                <div className="card" style={{ marginTop: 0 }}>
                    <div className="stat"><span className="value">{clan.members.length}</span><span className="label">Members</span></div>
                </div>
                <div className="card" style={{ marginTop: 0 }}>
                    <div className="stat"><span className="value">{totalElo}</span><span className="label">Combined Elo{activeSeason ? ` — ${activeSeason.name}` : ''}</span></div>
                </div>
                <div className="card" style={{ marginTop: 0 }}>
                    <div className="stat"><span className="value">{totalGames}</span><span className="label">Games played</span></div>
                </div>
            </div>

            <div className="card" style={{ padding: 0, marginTop: 18 }}>
                <div className="card-title" style={{ padding: '18px 18px 0' }}>Roster</div>
                <table className="table">
                    <thead>
                        <tr>
                            <th>Player</th>
                            <th>Best ladder</th>
                            <th>Rating</th>
                            <th>Role</th>
                        </tr>
                    </thead>
                    <tbody>
                        {members.map(member => {
                            const best = bestByMember.get(member.id);
                            return (
                                <tr key={member.id}>
                                    <td><Link href={`/player/${member.id}`}>{member.username}</Link></td>
                                    <td className="muted">{best ? `${gameName(best.game)} — ${best.mode}` : '—'}</td>
                                    <td className="num" style={best ? { color: getRankTier(best.rating).color, fontWeight: 700 } : undefined}>
                                        {best?.rating ?? '—'}
                                    </td>
                                    <td>{member.id === clan.leaderId ? <span className="pill pill-gold">Leader</span> : <span className="muted">Member</span>}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    );
}
