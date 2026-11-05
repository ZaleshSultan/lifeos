import { lazy, Suspense, useEffect, useState } from "react";
import { useSessionQuery } from "./api/hooks";
import { apiErrorMessage } from "./api/errors";
import { AppShell } from "./components/AppShell";
import { ErrorPanel, LoadingPanel } from "./components/AsyncState";
import { HomeScreen } from "./screens/HomeScreen";
import { OnboardingStatusScreen } from "./screens/OnboardingStatusScreen";
import type { ScreenId } from "./types";
import {
  resolveTmaLocation,
  sectionForScreen,
  tmaNavigationUrl,
  type PrimarySection,
} from "./lib/navigation";
import { DraftOwnerContext } from "./lib/session-draft";
import { ScreenLoadBoundary } from "./components/ScreenLoadBoundary";

const FocusScreen = lazy(() =>
  import("./screens/FocusScreen").then((module) => ({
    default: module.FocusScreen,
  })),
);

const CaptureScreen = lazy(() =>
  import("./screens/CaptureScreen").then((module) => ({
    default: module.CaptureScreen,
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

const DailyLifeScreen = lazy(() =>
  import("./screens/DailyLifeScreen").then((module) => ({
    default: module.DailyLifeScreen,
  })),
);

const IdealHumanScreen = lazy(() =>
  import("./screens/IdealHumanScreen").then((module) => ({
    default: module.IdealHumanScreen,
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

const SettingsScreen = lazy(() =>
  import("./screens/SettingsScreen").then((module) => ({
    default: module.SettingsScreen,
  })),
);
function initialLocation() {
  return resolveTmaLocation(new URLSearchParams(window.location.search));
}

export default function App() {
  const [location, setLocation] = useState(initialLocation);
  const { screen, section } = location;
  const [visited, setVisited] = useState<ScreenId[]>(() => [location.screen]);
  const [idealHumanDirty, setIdealHumanDirty] = useState(false);
  const [dailyLifeDirty, setDailyLifeDirty] = useState(false);
  const [aiRouterDirty, setAiRouterDirty] = useState(false);
  const [captureDirty, setCaptureDirty] = useState(false);
  const [academicDirty, setAcademicDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const setScreen = (next: ScreenId, nextSection = sectionForScreen(next)) => {
    const url = tmaNavigationUrl(window.location.href, {
      screen: next,
      section: nextSection,
    });
    window.history.pushState(null, "", url);
    setLocation(resolveTmaLocation(new URL(url).searchParams));
    setVisited((previous) =>
      previous.includes(next) ? previous : [...previous, next],
    );
    window.dispatchEvent(new Event("lifeos:navigation"));
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const openAcademicCourse = (
    courseId: string | null,
    studyTab: "grades" | "calculator" | "work" | "concierge",
  ) => {
    const url = new URL(window.location.href);
    if (courseId) url.searchParams.set("courseId", courseId);
    else url.searchParams.delete("courseId");
    url.searchParams.set("studyTab", studyTab);
    window.history.replaceState(null, "", url);
    setScreen("study");
  };
  const hasDrafts =
    idealHumanDirty ||
    dailyLifeDirty ||
    aiRouterDirty ||
    captureDirty ||
    academicDirty ||
    settingsDirty;
  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts]);
  const [aiDate, setAiDate] = useState<string>();
  const sessionQuery = useSessionQuery();

  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      tmaNavigationUrl(window.location.href, initialLocation()),
    );
    const restore = () => {
      const next = initialLocation();
      setLocation(next);
      setVisited((previous) =>
        previous.includes(next.screen) ? previous : [...previous, next.screen],
      );
      window.dispatchEvent(new Event("lifeos:navigation"));
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  if (sessionQuery.isLoading) {
    return (
      <AppShell
        onScreenChange={setScreen}
        screen={screen}
        section={section}
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
        section={section}
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
        section={section}
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
        section={section}
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
      <AppShell onScreenChange={setScreen} screen={screen} section={section}>
        {visited.map((view) => (
          <section
            key={view}
            hidden={screen !== view}
            aria-label={screen === view ? undefined : "Сохранённая форма"}
          >
            <ScreenLoadBoundary>
              <Suspense fallback={<LoadingPanel title="Загружаем раздел…" />}>
                {view === "home" ? (
                  <HomeScreen
                    {...{ onOpenAcademicCourse: openAcademicCourse }}
                    onOpenCapture={() => setScreen("capture")}
                    onOpenScholarship={() => setScreen("dashboard")}
                    onOpenWorkout={() => setScreen("workout")}
                    onOpenIdealHuman={() => setScreen("ideal-human")}
                    onOpenDailyLife={() => setScreen("daily-life")}
                    onOpenStudy={() => setScreen("study")}
                    onOpenAi={(date) => {
                      setAiDate(date);
                      setScreen("ai");
                    }}
                    session={sessionQuery.data}
                  />
                ) : null}
                {view === "capture" ? (
                  <CaptureScreen
                    onDirtyChange={setCaptureDirty}
                    onNavigate={setScreen}
                  />
                ) : null}
                {view === "ai" ? (
                  <AiScreen
                    date={aiDate}
                    onBack={() => setScreen("home")}
                    onDirtyChange={setAiRouterDirty}
                  />
                ) : null}
                {view === "workout" ? <WorkoutScreen /> : null}
                {view === "daily-life" ? (
                  <DailyLifeScreen
                    onOpenAcademicCourse={openAcademicCourse}
                    onOpenIdealHuman={() => setScreen("ideal-human")}
                    onOpenReminders={() => setScreen("reminders")}
                    onDirtyChange={setDailyLifeDirty}
                  />
                ) : null}
                {view === "ideal-human" ? (
                  <IdealHumanScreen
                    onOpenWorkout={() => setScreen("workout")}
                    onOpenHealth={() => setScreen("health")}
                    onOpenStudy={() => setScreen("study")}
                    onOpenReminders={() => setScreen("reminders")}
                    onDirtyChange={setIdealHumanDirty}
                  />
                ) : null}
                {view === "dashboard" ? (
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
                {view === "study" ? (
                  <StudyScreen
                    onOpenLms={() => setScreen("lms")}
                    onDirtyChange={setAcademicDirty}
                  />
                ) : null}
                {view === "lms" ? (
                  <Suspense
                    fallback={
                      <LoadingPanel title="Загружаем подключение LMS…" />
                    }
                  >
                    <LmsConnectionScreen onBack={() => setScreen("study")} />
                  </Suspense>
                ) : null}
                {view === "health" ? <HealthScreen /> : null}
                {view === "focus" ? <FocusScreen /> : null}
                {view === "finance" ? <FinanceScreen /> : null}
                {view === "sources" ? <SourcesScreen /> : null}
                {view === "reminders" ? <RemindersScreen /> : null}
                {view === "mode" ? <ModeScreen /> : null}
                {view === "settings" ? (
                  <SettingsScreen
                    onNavigate={(next) =>
                      setScreen(
                        next,
                        next === "sources" ||
                          next === "lms" ||
                          next === "reminders" ||
                          next === "mode"
                          ? "settings"
                          : sectionForScreen(next),
                      )
                    }
                    onDirtyChange={setSettingsDirty}
                  />
                ) : null}
              </Suspense>
            </ScreenLoadBoundary>
          </section>
        ))}
      </AppShell>
    </DraftOwnerContext.Provider>
  );
}
