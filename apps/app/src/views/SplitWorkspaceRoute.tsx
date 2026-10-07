import { useMemo } from "react";
import { matchPath, Navigate, useLocation } from "react-router-dom";
import {
  APP_ROOT_ROUTE_PATH,
  getThreadRoutePath,
  isProjectlessProjectId,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH,
} from "@/lib/route-paths";
import type { PaneContent } from "@/lib/split-layout";
import { useRouteState } from "@/hooks/useRouteState";
import { useThread } from "@/hooks/queries/thread-queries";
import { LegacyProjectComposeRedirect } from "./RootComposeView";
import { SplitThreadArea } from "./thread-detail/SplitThreadArea";

const ROOT_COMPOSE_CONTENT = { kind: "new-thread" } as const;

/**
 * The projectless thread URL (`/threads/:id`) is the personal project's
 * canonical thread shape. A standard-project thread opened through that form
 * resolves to its canonical project-scoped URL — `/projects/:pid/threads/:id`
 * — once the thread row is known, instead of dead-ending on the thread page's
 * bare "Not found" (the thread exists; only the URL form is wrong).
 *
 * Reads the thread query cache only (`enabled: false`): the page's own
 * bootstrap owns the fetch, and the cache write that lands it re-renders this
 * route. Redirecting on cached rows keeps the wrong form from painting a
 * not-found frame while the bootstrap is still in flight.
 *
 * Returns the canonical path while the redirect is pending, null when the
 * route is already canonical or the thread row is not resolved yet.
 */
function useCanonicalProjectlessThreadPath(
  projectId: string | undefined,
  threadId: string | undefined,
): string | null {
  const projectlessThreadId =
    isProjectlessProjectId(projectId) && threadId !== undefined
      ? threadId
      : null;
  const { data: thread } = useThread(projectlessThreadId ?? "", {
    enabled: false,
  });
  if (
    projectlessThreadId === null ||
    thread === undefined ||
    isProjectlessProjectId(thread.projectId)
  ) {
    return null;
  }
  return getThreadRoutePath({
    projectId: thread.projectId,
    threadId: thread.id,
  });
}

/**
 * Stable route owner for every page that can live in the split workspace.
 *
 * All supported URLs intentionally match the same outer `*` route in App.tsx.
 * Focus-driven URL changes therefore update `routeContent` without replacing
 * this component or remounting the split tree and its plugin/compose panes.
 */
export default function SplitWorkspaceRoute() {
  const location = useLocation();
  const { projectId, threadId, isThreadView } = useRouteState();
  const pluginMatch = matchPath(PLUGIN_PANEL_ROUTE_PATH, location.pathname);
  const legacyProjectMatch = matchPath(
    LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
    location.pathname,
  );
  const pluginId = pluginMatch?.params.pluginId;
  const panelPath = pluginMatch?.params.panelPath;
  const pluginSubPath = pluginMatch?.params["*"] ?? "";
  const canonicalThreadPath = useCanonicalProjectlessThreadPath(
    projectId,
    threadId,
  );

  const routeContent = useMemo<PaneContent | null>(() => {
    if (location.pathname === APP_ROOT_ROUTE_PATH) {
      return ROOT_COMPOSE_CONTENT;
    }
    if (isThreadView && projectId && threadId) {
      return { kind: "thread", projectId, threadId };
    }
    if (pluginId && panelPath) {
      return {
        kind: "plugin-panel",
        pluginId,
        panelPath,
        subPath: pluginSubPath,
      };
    }
    return null;
  }, [
    isThreadView,
    location.pathname,
    panelPath,
    pluginId,
    pluginSubPath,
    projectId,
    threadId,
  ]);

  const legacyProjectId = legacyProjectMatch?.params.projectId;
  if (legacyProjectId) {
    return <LegacyProjectComposeRedirect projectId={legacyProjectId} />;
  }
  if (routeContent === null) {
    return <Navigate to={APP_ROOT_ROUTE_PATH} replace />;
  }
  if (canonicalThreadPath !== null) {
    // Replace, not push: the wrong-form URL does not belong in history, and
    // query/hash deep links (?message=…, #event-…) ride along.
    return (
      <Navigate
        to={{
          pathname: canonicalThreadPath,
          search: location.search,
          hash: location.hash,
        }}
        replace
      />
    );
  }
  return <SplitThreadArea routeContent={routeContent} />;
}
