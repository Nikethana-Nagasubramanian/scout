import Link from "next/link";

export function ScoreBadge({ score, passed = true }: { score: number | null; passed?: boolean }) {
  const value = score ?? 0;
  const tone = !passed ? "danger" : value >= 80 ? "strong" : value >= 65 ? "good" : "muted";
  return <span className={`score-badge ${tone}`}>{!passed ? "Filtered" : `${value}%`}</span>;
}

export function ConfidenceBadge({ score }: { score: number | null }) {
  const value = score ?? 0;
  const tone = value >= 75 ? "strong" : value >= 55 ? "good" : "muted";
  return <span className={`score-badge ${tone}`} title="Posting confidence, not candidate fit">{value}% signal</span>;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{status.replaceAll("_", " ")}</span>;
}

export function EmptyState({
  title,
  body,
  href,
  action,
}: {
  title: string;
  body: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">◇</span>
      <h3>{title}</h3>
      <p>{body}</p>
      {href && action ? <Link className="button secondary" href={href}>{action}</Link> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children ? <div className="header-actions">{children}</div> : null}
    </header>
  );
}
