import Link from "next/link";

export function ScoreBadge({ score, passed = true }: { score: number | null; passed?: boolean }) {
  const value = score ?? 0;
  const tone = !passed ? "danger" : value >= 80 ? "strong" : value >= 65 ? "good" : "muted";
  return <span className={`score-badge ${tone}`} title="Profile match">{!passed ? "Filtered" : `${value}% match`}</span>;
}

export function ConfidenceBadge({ score }: { score: number | null }) {
  const value = score ?? 0;
  const tone = value >= 75 ? "strong" : value >= 55 ? "good" : "muted";
  return <span className={`score-badge ${tone}`} title="Posting signal, not profile match">{value}% signal</span>;
}

export function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    completed_with_errors: "Completed, source issue",
    completed_with_warnings: "Completed, cooldowns active",
    needs_verification: "Needs verification",
    needs_review: "Needs review",
    preparing: "Preparing application",
    ready_to_apply: "Ready to apply",
    shortlisted: "Resume started",
    recruiter_screen: "Recruiter screen",
    follow_up_due: "Follow-up due",
  };
  return (
    <span className={`status-pill status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {labels[status] || status.replaceAll("_", " ")}
    </span>
  );
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
