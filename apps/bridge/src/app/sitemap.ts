import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE_URL } from "@/lib/site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  // Do not claim a new modification date whenever a crawler requests the file.
  return PUBLIC_PATHS.map((path) => ({ url: `${SITE_URL}${path === "/" ? "/" : path}` }));
}
