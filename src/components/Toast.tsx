"use client";

import { useEffect, useState } from "react";

type ToastVariant = "error" | "success";
type ToastState = { msg: string; variant: ToastVariant };

let listener: ((toast: ToastState) => void) | null = null;

export function toast(msg: string, variant: ToastVariant = "error") {
  listener?.({ msg, variant });
}

export function Toaster() {
  const [toastState, setToastState] = useState<ToastState | null>(null);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    listener = (t) => {
      setToastState(t);
      clearTimeout(timeout);
      timeout = setTimeout(() => setToastState(null), 3000);
    };
    return () => { listener = null; };
  }, []);
  if (!toastState) return null;
  const bg = toastState.variant === "success" ? "bg-success" : "bg-danger";
  return (
    <div className={`fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-2xl ${bg} px-5 py-3 text-base font-medium text-white shadow-lg`}>
      {toastState.msg}
    </div>
  );
}
