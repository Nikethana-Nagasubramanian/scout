"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "Daily workflow",
    links: [
      { href: "/", label: "Overview" },
      { href: "/sources", label: "Job sources" },
      { href: "/jobs", label: "Jobs" },
      { href: "/queue", label: "Resume queue" },
      { href: "/applications", label: "Applications" },
      { href: "/contacts", label: "Contacts" },
    ],
  },
  {
    label: "Setup",
    links: [
      { href: "/profile", label: "Search profile" },
      { href: "/settings", label: "Automation" },
    ],
  },
  {
    label: "Advanced",
    links: [
      { href: "/diagnostics", label: "Developer logs" },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();
  if (pathname === "/onboarding") return null;

  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark">S</span>
        <span>
          <strong>Scout</strong>
          <small>Job search copilot</small>
        </span>
      </Link>
      <nav className="nav-list" aria-label="Primary navigation">
        {groups.map((group) => (
          <section className="nav-group" key={group.label}>
            <p className="nav-group-label">{group.label}</p>
            {group.links.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              return <Link className={active ? "nav-link active" : "nav-link"} href={link.href} key={link.href}>{link.label}</Link>;
            })}
          </section>
        ))}
      </nav>
    </aside>
  );
}
