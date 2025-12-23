"use client";

import dynamicImport from "next/dynamic";

const SearchPageClient = dynamicImport(() => import("./SearchPageClient"), {
  ssr: false,
});

export default function SearchPage() {
  return <SearchPageClient />;
}
