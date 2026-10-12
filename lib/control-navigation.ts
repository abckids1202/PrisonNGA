export type ControlMode = "operations" | "management";

const operationsPages = new Set(["Command Center", "Appointments", "Waiting Room", "Live Sessions", "Resources", "Incidents"]);
const managementPages = new Set(["People", "Visitation", "Finance", "Compliance", "Facility", "Administration"]);

export function parseControlNavigation(search: string): { mode: ControlMode; page: string } {
  const params = new URLSearchParams(search);
  const requestedMode = params.get("workspace") === "management" ? "management" : "operations";
  const requestedPage = params.get("page") || "";
  const allowedPages = requestedMode === "management" ? managementPages : operationsPages;
  return {
    mode: requestedMode,
    page: allowedPages.has(requestedPage) ? requestedPage : requestedMode === "management" ? "People" : "Command Center",
  };
}

export function controlNavigationUrl(mode: ControlMode, page: string): string {
  return `/?workspace=${mode}&page=${encodeURIComponent(page)}`;
}
