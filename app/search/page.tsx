import dynamicImport from "next/dynamic";

export const dynamic = 'force-dynamic';

const SearchPageClient = dynamicImport(() => import("./SearchPageClient"), {
  ssr: false,
});

export default function SearchPage() {
  return <SearchPageClient />;
}
