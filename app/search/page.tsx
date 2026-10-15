"use client";

import { useSearchParams } from 'next/navigation';
import dynamicImport from "next/dynamic";

const SearchPageClient = dynamicImport(() => import("./SearchPageClient"), {
  ssr: false,
});

export default function SearchPage() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const requestedType = searchParams.get('type') ?? 'all';
  const type = ['all', 'course', 'event', 'member', 'post', 'resource'].includes(requestedType)
    ? requestedType
    : 'all';
  const requestedPage = Number(searchParams.get('page') ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, 1000)
    : 1;

  return <SearchPageClient initialQuery={query} initialType={type} initialPage={page} />;
}
