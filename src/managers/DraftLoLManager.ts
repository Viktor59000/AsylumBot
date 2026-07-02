export class DraftLoLManager {
    static createDraftLink(team1Name: string, team2Name: string): string {
        // Since there is no public API to create a room and get an ID without auth,
        // we will generate a pre-filled URL for the user to click and setup.
        // Alternatively, we can use a service like prodraft.gg if it has an API.
        // For now, we will point them to the tool with names.

        // A better approach for "Premium" feel without a real backend integration (which doesn't exist publicly)
        // is to use a consistent "Manual Draft" message or a generic link.

        // However, the user specifically asked for "DraftLoL" links.
        // Let's generate a generic link to the site.
        return 'https://draftlol.gg/';
    }
}
