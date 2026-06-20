import { useState } from "react";
import { useSessionQuery } from "./api/hooks";
import { AppShell } from "./components/AppShell";
import { ErrorPanel, LoadingPanel } from "./components/AsyncState";
import { FocusScreen } from "./screens/FocusScreen";
import { FinanceScreen } from "./screens/FinanceScreen";
import { HealthScreen } from "./screens/HealthScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { ModeScreen } from "./screens/ModeScreen";
import { OnboardingStatusScreen } from "./screens/OnboardingStatusScreen";
import { RemindersScreen } from "./screens/RemindersScreen";
import { SourcesScreen } from "./screens/SourcesScreen";
import { WorkoutScreen } from "./screens/WorkoutScreen";
import type { ScreenId } from "./types";

const SCREENS: ScreenId[] = [
  "home",
  "workout",
  "health",
  "focus",
  "finance",
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
  const sessionQuery = useSessionQuery();

  if (sessionQuery.isLoading) {
    return (
      <AppShell
        onScreenChange={setScreen}
        screen={screen}
        showNavigation={false}
        statusLabel="Session"
      >
        <LoadingPanel title="Loading session" />
      </AppShell>
    );
  }

  if (sessionQuery.isError) {
    return (
      <AppShell
        onScreenChange={setScreen}
        screen={screen}
        showNavigation={false}
        statusLabel="Offline"
      >
        <ErrorPanel
          detail={sessionQuery.error.message}
          onRetry={() => void sessionQuery.refetch()}
          title="Session unavailable"
        />
      </AppShell>
    );
  }

  if (!sessionQuery.data) {
    return (
      <AppShell
        onScreenChange={setScreen}
        screen={screen}
        showNavigation={false}
        statusLabel="Session"
      >
        <ErrorPanel
          onRetry={() => void sessionQuery.refetch()}
          title="Session returned no data"
        />
      </AppShell>
    );
  }

  if (sessionQuery.data.state !== "active") {
    return (
      <AppShell
        onScreenChange={setScreen}
        screen={screen}
        showNavigation={false}
        statusLabel={sessionQuery.data.state}
      >
        <OnboardingStatusScreen
          onRetry={() => void sessionQuery.refetch()}
          session={sessionQuery.data}
        />
      </AppShell>
    );
  }

  return (
    <AppShell onScreenChange={setScreen} screen={screen}>
      {screen === "home" ? (
        <HomeScreen
          onOpenWorkout={() => setScreen("workout")}
          session={sessionQuery.data}
        />
      ) : null}
      {screen === "workout" ? <WorkoutScreen /> : null}
      {screen === "health" ? <HealthScreen /> : null}
      {screen === "focus" ? <FocusScreen /> : null}
      {screen === "finance" ? <FinanceScreen /> : null}
      {screen === "sources" ? <SourcesScreen /> : null}
      {screen === "reminders" ? <RemindersScreen /> : null}
      {screen === "mode" ? <ModeScreen /> : null}
    </AppShell>
  );
}
