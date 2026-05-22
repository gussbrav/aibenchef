import type { Metadata } from "next";

import { CatalogClient } from "./catalog-client";

export const metadata: Metadata = {
  title: "Catalog",
};

export const dynamic = "force-dynamic";

export default function CatalogPage() {
  return (
    <div className="-mx-4 -my-4">
      <CatalogClient />
    </div>
  );
}
