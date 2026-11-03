import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IdealHumanConflictError,
  IdealHumanInputError,
  clearIdealHumanReflection,
  hasIdealHumanReflection,
  parseIdealHumanDay,
  parseIdealHumanReflectionClear,
  parseStoredIdealHumanDay,
  type IdealHumanDay,
} from "@lifeos/core";
import type { Database, Json } from "./types.js";

/** Every operation is scoped at the API boundary and again in SQL. */
export function idealHumanStore(client: SupabaseClient<Database>) {
  async function persist(
    userId: string,
    day: IdealHumanDay,
    expectedRevision: number,
  ): Promise<IdealHumanDay> {
    const { revision: _revision, ...entry } = day;
    const { data, error } = await client.rpc("save_ideal_human_day", {
      p_user_id: userId,
      p_date: day.date,
      p_entry: entry as unknown as Json,
      p_expected_revision: expectedRevision,
    });
    if (error?.message === "ideal_human_conflict")
      throw new IdealHumanConflictError();
    if (error || !data) throw new Error("Ideal Human save unavailable");
    return parseStoredIdealHumanDay(data);
  }

  return {
    async getDays(userId: string): Promise<IdealHumanDay[]> {
      const { data, error } = await client
        .from("ideal_human_days")
        .select("date,entry,revision")
        .eq("user_id", userId)
        .order("date", { ascending: true });
      if (error) throw new Error("Ideal Human storage unavailable");
      return (data ?? []).map((row) => {
        try {
          if (
            !row.entry ||
            typeof row.entry !== "object" ||
            Array.isArray(row.entry)
          )
            throw new Error();
          return parseStoredIdealHumanDay({
            ...row.entry,
            date: row.date,
            revision: row.revision,
          });
        } catch {
          // Never send database diagnostics or private record content in an error.
          throw new Error(
            "A saved Ideal Human entry needs recovery; no data was changed",
          );
        }
      });
    },
    async saveDay(
      userId: string,
      input: IdealHumanDay,
      expectedRevision: number,
    ): Promise<IdealHumanDay> {
      const day = parseIdealHumanDay(input);
      if (
        !Number.isInteger(expectedRevision) ||
        expectedRevision < 0 ||
        day.revision !== expectedRevision
      )
        throw new IdealHumanInputError("Invalid expected revision");
      return persist(userId, day, expectedRevision);
    },
    async clearReflection(
      userId: string,
      date: string,
      expectedRevision: number,
    ): Promise<IdealHumanDay> {
      parseIdealHumanReflectionClear({
        date,
        expectedRevision,
        confirmed: true,
      });
      const { data, error } = await client
        .from("ideal_human_days")
        .select("date,entry,revision")
        .eq("user_id", userId)
        .eq("date", date)
        .maybeSingle();
      if (error) throw new Error("Ideal Human storage unavailable");
      // A client revision never proves a row exists or authorizes its creation.
      if (!data) throw new IdealHumanConflictError();
      let day: IdealHumanDay;
      try {
        if (
          !data.entry ||
          typeof data.entry !== "object" ||
          Array.isArray(data.entry)
        )
          throw new Error();
        day = parseStoredIdealHumanDay({
          ...data.entry,
          date: data.date,
          revision: data.revision,
        });
      } catch {
        throw new Error(
          "A saved Ideal Human entry needs recovery; no data was changed",
        );
      }
      if (day.revision !== expectedRevision)
        throw new IdealHumanConflictError();
      if (!hasIdealHumanReflection(day)) return day;
      // Reuse the atomic owner/date RPC: an intervening write must conflict.
      return persist(userId, clearIdealHumanReflection(day), expectedRevision);
    },
  };
}
