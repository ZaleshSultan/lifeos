import { lazy, Suspense, useEffect, useState } from "react";
import { useSessionQuery } from "./api/hooks";
import { apiErrorMessage } from "./api/errors";
import { AppShell } from "./components/AppShell";
import { ErrorPanel, LoadingPanel } from "./components/AsyncState";
import { HomeScreen } from "./screens/HomeScreen";
import { OnboardingStatusScreen } from "./screens/OnboardingStatusScreen";
import type { ScreenId } from "./types";
import { DraftOwnerContext } from "./lib/session-draft";
import { ScreenLoadBoundary } from "./components/ScreenLoadBoundary";

const FocusScreen = lazy(() =>
  import("./screens/FocusScreen").then((module) => ({
    default: module.FocusScreen,
  })),
);

const FinanceScreen = lazy(() =>
  import("./screens/FinanceScreen").then((module) => ({
    default: module.FinanceScreen,
  })),
);

const HealthScreen = lazy(() =>
  import("./screens/HealthScreen").then((module) => ({
    default: module.HealthScreen,
  })),
);

const ModeScreen = lazy(() =>
  import("./screens/ModeScreen").then((module) => ({
    default: module.ModeScreen,
  })),
);

const RemindersScreen = lazy(() =>
  import("./screens/RemindersScreen").then((module) => ({
    default: module.RemindersScreen,
  })),
);

const SourcesScreen = lazy(() =>
  import("./screens/SourcesScreen").then((module) => ({
    default: module.SourcesScreen,
  })),
);

const WorkoutScreen = lazy(() =>
  import("./screens/WorkoutScreen").then((module) => ({
    default: module.WorkoutScreen,
  })),
);

const StudyScreen = lazy(() =>
  import("./screens/StudyScreen").then((module) => ({
    default: module.StudyScreen,
  })),
);

const StudyDashboardScreen = lazy(() =>
  import("./screens/StudyDashboardScreen").then((module) => ({
    default: module.StudyDashboardScreen,
  })),
);

const AiScreen = lazy(() =>
  import("./screens/AiScreen").then((module) => ({
    default: module.AiScreen,
  })),
);

const LmsConnectionScreen = lazy(() =>
  import("./screens/LmsConnectionScreen").then((module) => ({
    default: module.LmsConnectionScreen,
  })),
);

const SCREENS: ScreenId[] = [
  "home",
  "ai",
  "study",
  "dashboard",
  "lms",
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
  const [aiDate, setAiDate] = useState<string>();
  const sessionQuery = useSessionQuery();

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("screen", screen);
    window.history.replaceState(null, "", url);
  }, [screen]);

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
          detail={apiErrorMessage(sessionQuery.error)}
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
    <DraftOwnerContext.Provider
      key={sessionQuery.data.telegramUserId}
      value={sessionQuery.data.telegramUserId}
    >
      <AppShell onScreenChange={setScreen} screen={screen}>
        <ScreenLoadBoundary key={screen}>
          <Suspense fallback={<LoadingPanel title="Загружаем раздел…" />}>
            {screen === "home" ? (
              <HomeScreen
                onOpenScholarship={() => setScreen("dashboard")}
                onOpenWorkout={() => setScreen("workout")}
                onOpenStudy={() => setScreen("study")}
                onOpenAi={(date) => {
                  setAiDate(date);
                  setScreen("ai");
                }}
                session={sessionQuery.data}
              />
            ) : null}
            {screen === "ai" ? (
              <AiScreen date={aiDate} onBack={() => setScreen("home")} />
            ) : null}
            {screen === "workout" ? <WorkoutScreen /> : null}
            {screen === "dashboard" ? (
              <StudyDashboardScreen
                onOpenStudy={() => setScreen("study")}
                onOpenLms={() => setScreen("lms")}
                onOpenCalculator={(courseId) => {
                  const url = new URL(window.location.href);
                  url.searchParams.set("studyTab", "calculator");
                  url.searchParams.set("courseId", courseId);
                  window.history.replaceState(null, "", url);
                  setScreen("study");
                }}
              />
            ) : null}
            {screen === "study" ? (
              <StudyScreen onOpenLms={() => setScreen("lms")} />
            ) : null}
            {screen === "lms" ? (
              <Suspense
                fallback={<LoadingPanel title="Загружаем подключение LMS…" />}
              >
                <LmsConnectionScreen onBack={() => setScreen("study")} />
              </Suspense>
            ) : null}
            {screen === "health" ? <HealthScreen /> : null}
            {screen === "focus" ? <FocusScreen /> : null}
            {screen === "finance" ? <FinanceScreen /> : null}
            {screen === "sources" ? <SourcesScreen /> : null}
            {screen === "reminders" ? <RemindersScreen /> : null}
            {screen === "mode" ? <ModeScreen /> : null}
          </Suspense>
        </ScreenLoadBoundary>
      </AppShell>
    </DraftOwnerContext.Provider>
  );
}
