"use client";

import { useEffect, useState } from "react";

let listener: ((msg: string) => void) | null = null;

export function toast(msg: string) {
  listener?.(msg);
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    listener = (m) => {
      setMsg(m);
      clearTimeout(timeout);
      timeout = setTimeout(() => setMsg(null), 3000);
    };
    return () => { listener = null; };
  }, []);
  if (!msg) return null;
  return (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
      {msg}
    </div>
  );
}
