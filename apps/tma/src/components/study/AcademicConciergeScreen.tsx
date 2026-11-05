import { useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, apiErrorMessage } from "../../api/client";
import {
  academicTransport,
  type AcademicSnapshot,
} from "../../api/study-concierge";
import { telegram } from "../../telegram";
import { ErrorPanel, LoadingPanel } from "../AsyncState";
import { AcademicConcierge } from "./AcademicConcierge";

const queryKey = ["study", "academic-concierge"] as const;
export function AcademicConciergeScreen({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const client = useQueryClient();
  const transport = useMemo(
    () =>
      academicTransport(<T,>(resource: string, options?: RequestInit) =>
        request<T>("/api/tma/" + resource, options),
      ),
    [],
  );
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => transport.overview(signal),
    refetchOnWindowFocus: false,
  });
  const onSnapshot = useCallback(
    (snapshot: AcademicSnapshot) => {
      client.setQueryData(queryKey, snapshot);
      telegram.hapticImpact("light");
    },
    [client],
  );
  if (query.isPending)
    return <LoadingPanel title="Загружаем экзамены и учебный календарь…" />;
  if (!query.data)
    return (
      <ErrorPanel
        title="Учебный консьерж пока недоступен"
        detail={apiErrorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <AcademicConcierge
      transport={transport}
      initial={query.data}
      errorMessage={apiErrorMessage}
      onSnapshot={onSnapshot}
      onDirtyChange={onDirtyChange}
    />
  );
}
