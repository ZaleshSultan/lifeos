import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { FocusScreen } from "./screens/FocusScreen";
import { HealthScreen } from "./screens/HealthScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { ModeScreen } from "./screens/ModeScreen";
import { WorkoutScreen } from "./screens/WorkoutScreen";
import type { ScreenId } from "./types";

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("home");

  return (
    <AppShell onScreenChange={setScreen} screen={screen}>
      {screen === "home" ? (
        <HomeScreen onOpenWorkout={() => setScreen("workout")} />
      ) : null}
      {screen === "workout" ? <WorkoutScreen /> : null}
      {screen === "health" ? <HealthScreen /> : null}
      {screen === "focus" ? <FocusScreen /> : null}
      {screen === "mode" ? <ModeScreen /> : null}
    </AppShell>
  );
}
