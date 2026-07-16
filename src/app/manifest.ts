import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Baby Marks",
    short_name: "Baby Marks",
    description: "Baby feeding & sleep tracker",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6f1",
    theme_color: "#faf6f1",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
