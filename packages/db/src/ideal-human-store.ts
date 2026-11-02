import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IdealHumanConflictError,
  IdealHumanInputError,
  parseIdealHumanDay,
  type IdealHumanDay,
} from "@lifeos/core";
import type { Database, Json } from "./types.js";

/** Every operation is scoped at the API boundary and again in SQL. */
export function idealHumanStore(client: SupabaseClient<Database>) {
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
          return parseIdealHumanDay({
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
      return parseIdealHumanDay(data);
    },
  };
}
