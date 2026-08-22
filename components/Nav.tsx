"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "Daily workflow",
    links: [
      { href: "/", label: "Overview" },
      { href: "/sources", label: "Job sources" },
      { href: "/jobs", label: "Jobs" },
      { href: "/signals", label: "Target companies" },
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
        <Image className="brand-mark" src="/assets/scout-mark.svg" width={30} height={30} alt="" aria-hidden="true" />
        <strong>Scout</strong>
      </Link>
      <nav className="nav-list" aria-label="Primary navigation">
        {groups.map((group) => (
          <section className="nav-group" key={group.label}>
            <p className="nav-group-label">{group.label}</p>
            <div className="nav-links">
              {group.links.map((link) => {
                const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
                return <Link className={active ? "nav-link active" : "nav-link"} href={link.href} key={link.href}>{link.label}</Link>;
              })}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
