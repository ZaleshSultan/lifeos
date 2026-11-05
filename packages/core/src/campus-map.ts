import data from "./campus-map-data.json" with { type: "json" };

export const CAMPUS_MAP_URL = "https://yuujiso.github.io/aitumap/";
export const CAMPUS_MAP_SOURCE = "https://github.com/Yuujiso/aitumap";
export const CAMPUS_MAP_COMMIT = data.sourceCommit;

export interface CampusRoomMatch {
  requestedRoom: string | null;
  roomId: string | null;
  match: "exact" | "reviewed_alias" | "unresolved";
  block: string | null;
  floor: number | null;
  imagePath: string | null;
  imageSha256: string | null;
  imageBytes: number | null;
  interactiveUrl: string;
}

/** Resolves only pinned public inventory and individually reviewed aliases. */
export function resolveCampusRoom(value: unknown): CampusRoomMatch {
  const requestedRoom =
    typeof value === "string" && value.length <= 40
      ? value.trim().toUpperCase()
      : null;
  const unresolved: CampusRoomMatch = {
    requestedRoom,
    roomId: null,
    match: "unresolved",
    block: null,
    floor: null,
    imagePath: null,
    imageSha256: null,
    imageBytes: null,
    interactiveUrl: CAMPUS_MAP_URL,
  };
  if (!requestedRoom || !/^C1\.[123]\.[123][0-9]{2}[KLP]?$/.test(requestedRoom))
    return unresolved;
  const roomId = Object.prototype.hasOwnProperty.call(data.rooms, requestedRoom)
    ? requestedRoom
    : (data.aliases as Record<string, string>)[requestedRoom];
  if (!roomId || !Object.prototype.hasOwnProperty.call(data.rooms, roomId))
    return unresolved;
  const entry = (
    data.rooms as Record<
      string,
      {
        block: string;
        floor: number;
        imagePath: string;
        sha256: string | null;
        bytes?: number;
      }
    >
  )[roomId];
  if (!entry.sha256 || !/^[a-f0-9]{64}$/.test(entry.sha256) || !entry.bytes)
    return unresolved;
  return {
    requestedRoom,
    roomId,
    match: requestedRoom === roomId ? "exact" : "reviewed_alias",
    block: entry.block,
    floor: entry.floor,
    imagePath: entry.imagePath,
    imageSha256: entry.sha256,
    imageBytes: entry.bytes,
    interactiveUrl: CAMPUS_MAP_URL,
  };
}
