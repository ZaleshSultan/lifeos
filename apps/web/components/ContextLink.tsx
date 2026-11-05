"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { webNavigationHref, type WebSection } from "../lib/navigation";
/** Contextual shortcuts use the same bounded course/day parameters as the shell. */
export function ContextLink({
  href,
  section,
  children,
  className,
}: {
  href: string;
  section: WebSection;
  children: ReactNode;
  className?: string;
}) {
  const search = useSearchParams().toString();
  return (
    <Link
      prefetch={false}
      href={webNavigationHref(href, search, section)}
      className={className}
    >
      {children}
    </Link>
  );
}
