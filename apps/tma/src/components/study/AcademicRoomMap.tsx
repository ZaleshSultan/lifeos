import { useState } from "react";
import { ExternalLink, MapPinned } from "lucide-react";
import {
  CAMPUS_MAP_SOURCE,
  resolveCampusRoom,
} from "../../../../../packages/core/src/campus-map.js";

export function AcademicRoomMap({ location }: { location: string | null }) {
  const room = resolveCampusRoom(location);
  const [failed, setFailed] = useState(false);
  return (
    <div className="mt-3 min-w-0 space-y-2">
      {room.imagePath && !failed ? (
        <details className="rounded-lg border border-white/[0.08] p-3">
          <summary className="min-h-11 cursor-pointer text-sm text-cyan-200">
            <MapPinned className="mr-1 inline h-4 w-4" aria-hidden="true" />
            Схема аудитории {room.requestedRoom} · этаж {room.floor}
          </summary>
          <a href={room.imagePath} target="_blank" rel="noopener noreferrer">
            <img
              src={room.imagePath}
              alt={`На карте Yuujiso выделена аудитория ${room.roomId}, блок ${room.block}, этаж ${room.floor}`}
              loading="lazy"
              width={720}
              height={860}
              onError={() => setFailed(true)}
              className="mt-2 h-auto max-h-[640px] w-full rounded-lg object-contain"
            />
          </a>
          {room.match === "reviewed_alias" ? (
            <p className="mt-2 text-xs text-zinc-300">
              В источнике: {room.requestedRoom}. Проверенное обозначение на
              карте: {room.roomId}.
            </p>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            Геометрия Yuujiso/aitumap · MIT © 2023 Yuujiso. Схема расположения,
            без маршрута и времени в пути.{" "}
            <a
              href={CAMPUS_MAP_SOURCE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-200 underline"
            >
              Источник
            </a>
          </p>
        </details>
      ) : (
        <p className="text-xs text-zinc-400">
          {location
            ? "Точное место на карте не подтверждено."
            : "Аудитория не указана."}
          {failed ? " Схема не загрузилась." : ""}
        </p>
      )}
      <a
        href={room.interactiveUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-cyan-200 underline underline-offset-2"
      >
        Интерактивная карта AITU{" "}
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  );
}
