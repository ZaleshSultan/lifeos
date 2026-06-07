import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { FocusScreen } from "./screens/FocusScreen";
import { HealthScreen } from "./screens/HealthScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { ModeScreen } from "./screens/ModeScreen";
import { RemindersScreen } from "./screens/RemindersScreen";
import { SourcesScreen } from "./screens/SourcesScreen";
import { WorkoutScreen } from "./screens/WorkoutScreen";
import type { ScreenId } from "./types";

const SCREENS: ScreenId[] = [
  "home",
  "workout",
  "health",
  "focus",
  "sources",
  "reminders",
  "mode",
];

function initialScreen(): ScreenId {
  const params = new URLSearchParams(window.location.search);
  const requestedScreen = params.get("screen");

  if (requestedScreen && SCREENS.includes(requestedScreen as ScreenId)) {
    return requestedScreen as ScreenId;
  }

  return params.has("workoutId") ? "workout" : "home";
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>(initialScreen);

  return (
    <AppShell onScreenChange={setScreen} screen={screen}>
      {screen === "home" ? (
        <HomeScreen onOpenWorkout={() => setScreen("workout")} />
      ) : null}
      {screen === "workout" ? <WorkoutScreen /> : null}
      {screen === "health" ? <HealthScreen /> : null}
      {screen === "focus" ? <FocusScreen /> : null}
      {screen === "sources" ? <SourcesScreen /> : null}
      {screen === "reminders" ? <RemindersScreen /> : null}
      {screen === "mode" ? <ModeScreen /> : null}
    </AppShell>
  );
}
