import { getRankTier } from '@/lib/game';

export function RankBadge({ rating }: { rating: number }) {
    const tier = getRankTier(rating);
    return (
        <span className="pill">
            <span className="rank-dot" style={{ background: tier.color }} />
            {tier.name}
        </span>
    );
}
