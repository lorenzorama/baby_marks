import type { EventType } from "./types";

export const activityIcon: Record<EventType, string> = {
  feed: "🍼", sleep: "😴", diaper: "🧷", pump: "🥛", medicine: "💊",
};

export const activityTint: Record<EventType, string> = {
  feed: "bg-feed-tint", sleep: "bg-sleep-tint", diaper: "bg-diaper-tint",
  pump: "bg-pump-tint", medicine: "bg-medicine-tint",
};

export const activityAccentBg: Record<EventType, string> = {
  feed: "bg-feed", sleep: "bg-sleep", diaper: "bg-diaper",
  pump: "bg-pump", medicine: "bg-medicine",
};

export const activityAccentText: Record<EventType, string> = {
  feed: "text-feed", sleep: "text-sleep", diaper: "text-diaper",
  pump: "text-pump", medicine: "text-medicine",
};
