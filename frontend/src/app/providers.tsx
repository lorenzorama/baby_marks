"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LayoutModeProvider } from "@/hooks/useLayoutMode";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({
      defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
    }),
  );
  return (
    <QueryClientProvider client={client}>
      <LayoutModeProvider>{children}</LayoutModeProvider>
    </QueryClientProvider>
  );
}
