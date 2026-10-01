import Link from 'next/link';

// "Nothing here yet" with the next step as a button (Jira 24e), instead of a dead-end sentence.
// action: { label, href } for a link, or { label, onClick } for a button.
export default function EmptyState({ icon: Icon, children, action }) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={28} color="var(--text-faint)" aria-hidden="true" />}
      <p style={{ margin: 0, maxWidth: 420 }}>{children}</p>
      {action && (action.href
        ? <Link href={action.href}><button type="button" className="primary">{action.label}</button></Link>
        : <button type="button" className="primary" onClick={action.onClick}>{action.label}</button>)}
    </div>
  );
}
