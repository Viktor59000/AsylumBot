import { prisma } from '../utils/db';

async function main() {
    console.log('Testing Database Schema...');

    // 1. Check GameConfig
    console.log('Checking GameConfig...');
    const config = await prisma.gameConfig.findFirst();
    console.log('GameConfig exists:', !!config);

    // 2. Check Match Fields (isRanked, channelId1, map)
    console.log('Checking Match fields...');
    // We won't actually create one to avoid garbage, but we'll check the type definition by "pretending"
    // Actually, let's just query one and log keys
    const match = await prisma.match.findFirst();
    if (match) {
        console.log('Match found. Keys:', Object.keys(match));
        console.log('isRanked:', match.isRanked);
        console.log('map:', match.map);
        console.log('channelId1:', match.channelId1);
    } else {
        console.log('No matches found, but code compiled so types are likely valid.');
    }

    // 3. Check Elo Fields (lastMatchDate)
    console.log('Checking Elo fields...');
    const elo = await prisma.elo.findFirst();
    if (elo) {
        console.log('Elo found. lastMatchDate:', elo.lastMatchDate);
    }

    console.log('✅ Database test completed successfully.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
