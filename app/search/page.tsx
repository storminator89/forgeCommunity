"use client";

import { useSearchParams } from 'next/navigation';
import dynamicImport from "next/dynamic";

const SearchPageClient = dynamicImport(() => import("./SearchPageClient"), {
  ssr: false,
});

export default function SearchPage() {
  const query = useSearchParams().get('q') ?? '';
  return <SearchPageClient key={query} initialQuery={query} />;
}
