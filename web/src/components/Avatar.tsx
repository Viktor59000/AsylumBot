export function Avatar({ name }: { name: string }) {
    const initials = name.slice(0, 2).toUpperCase();
    return <span className="avatar">{initials}</span>;
}
