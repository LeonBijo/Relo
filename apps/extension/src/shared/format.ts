/**
 * Formats seconds into m:ss or h:mm:ss using Unicode ratio colon for clean tabular alignment.
 */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}∶${String(minutes).padStart(2, "0")}∶${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}∶${String(secs).padStart(2, "0")}`;
}
