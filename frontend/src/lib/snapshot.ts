export const MAX_SNAPSHOT_PX = 1280;
export const SNAPSHOT_QUALITY = 0.8;

/** Scale (w, h) so the long side is at most `max`, keeping the aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const ratio = max / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** Freeze the current frame of a playing <video> into a JPEG blob. */
export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const { width, height } = fitWithin(
    video.videoWidth,
    video.videoHeight,
    MAX_SNAPSHOT_PX,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", SNAPSHOT_QUALITY),
  );
  if (!blob) throw new Error("snapshot failed");
  return blob;
}
