import { useState } from "react";

export function WorkoutExerciseGif({
  gifUrl,
  name,
}: {
  gifUrl?: string | null;
  name: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!gifUrl || failedUrl === gifUrl) return null;

  return (
    <img
      src={gifUrl}
      alt={`Техника упражнения: ${name}`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="my-3 max-h-56 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] object-contain"
      onError={() => setFailedUrl(gifUrl)}
    />
  );
}
