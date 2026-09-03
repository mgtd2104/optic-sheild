import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AlertsSidebar from "./AlertsSidebar";
import { LiveAlert } from "../types/detection";

function makeAlert(overrides: Partial<LiveAlert>): LiveAlert {
  return {
    id: "ALT-0001",
    timestamp: "2026-09-01T10:00:00.000Z",
    cameraID: "CAM-BDR-001",
    location: { lat: 28.9845, lng: 77.7064, name: "BOP-01 Alpha - Akhnoor Sector" },
    alertType: "INTRUSION",
    severity: "HIGH",
    thumbnailImg: "https://example.com/thumb.jpg",
    confidence: 0.92,
    ...overrides,
  };
}

const ALERTS: LiveAlert[] = [
  makeAlert({
    id: "ALT-0001",
    timestamp: "2026-09-01T10:00:00.000Z",
    alertType: "INTRUSION",
    severity: "CRITICAL",
    cameraID: "CAM-BDR-001",
  }),
  makeAlert({
    id: "ALT-0002",
    timestamp: "2026-09-01T10:05:00.000Z", // newest
    alertType: "ANPR",
    severity: "MEDIUM",
    cameraID: "CAM-PER-002",
    location: { lat: 30.3165, lng: 78.0322, name: "BOP-02 Bravo - Uttarkashi Sector" },
  }),
  makeAlert({
    id: "ALT-0003",
    timestamp: "2026-09-01T09:55:00.000Z", // oldest
    alertType: "FRS_WATCHLIST",
    severity: "HIGH",
    cameraID: "CAM-MOB-001",
  }),
];

describe("AlertsSidebar", () => {
  it("shows a loading skeleton when loading", () => {
    render(
      <AlertsSidebar alerts={[]} selectedAlertId={null} onAlertClick={vi.fn()} loading />
    );
    expect(screen.getByText("ALERT FEED")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Active alerts" })).not.toBeInTheDocument();
  });

  it("shows an error state with a retry action", () => {
    render(
      <AlertsSidebar
        alerts={[]}
        selectedAlertId={null}
        onAlertClick={vi.fn()}
        error="Connection lost"
      />
    );
    expect(screen.getByText("Failed to load alerts")).toBeInTheDocument();
    expect(screen.getByText("Connection lost")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry connection/i })).toBeInTheDocument();
  });

  it("shows an empty state when there are no alerts", () => {
    render(<AlertsSidebar alerts={[]} selectedAlertId={null} onAlertClick={vi.fn()} />);
    expect(screen.getByText("No alerts match filters")).toBeInTheDocument();
  });

  it("renders all alerts sorted newest-first", () => {
    render(<AlertsSidebar alerts={ALERTS} selectedAlertId={null} onAlertClick={vi.fn()} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    // ALT-0002 (10:05) is newest, ALT-0003 (09:55) is oldest.
    expect(within(items[0]).getByText("ANPR")).toBeInTheDocument();
    expect(within(items[2]).getByText("FRS WATCHLIST")).toBeInTheDocument();
  });

  it("filters alerts by type", async () => {
    const user = userEvent.setup();
    render(<AlertsSidebar alerts={ALERTS} selectedAlertId={null} onAlertClick={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "ANPR" }));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText("ANPR")).toBeInTheDocument();
  });

  it("filters alerts by severity", async () => {
    const user = userEvent.setup();
    render(<AlertsSidebar alerts={ALERTS} selectedAlertId={null} onAlertClick={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "CRITICAL" }));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText("INTRUSION")).toBeInTheDocument();
  });

  it("filters alerts via the search box across camera, location, type and id", async () => {
    const user = userEvent.setup();
    render(<AlertsSidebar alerts={ALERTS} selectedAlertId={null} onAlertClick={vi.fn()} />);

    await user.type(screen.getByLabelText("Search alerts"), "Uttarkashi");

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText("ANPR")).toBeInTheDocument();
  });

  it("shows the no-match empty state when filters exclude everything", async () => {
    const user = userEvent.setup();
    render(<AlertsSidebar alerts={ALERTS} selectedAlertId={null} onAlertClick={vi.fn()} />);

    await user.type(screen.getByLabelText("Search alerts"), "no-such-camera");

    expect(screen.getByText("No alerts match filters")).toBeInTheDocument();
  });

  it("calls onAlertClick when an alert is clicked", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<AlertsSidebar alerts={ALERTS} selectedAlertId={null} onAlertClick={handleClick} />);

    await user.click(screen.getAllByRole("listitem")[0]);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick.mock.calls[0][0].id).toBe("ALT-0002"); // newest, rendered first
  });

  it("calls onAlertClick on Enter key for keyboard accessibility", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<AlertsSidebar alerts={ALERTS} selectedAlertId={null} onAlertClick={handleClick} />);

    const firstItem = screen.getAllByRole("listitem")[0];
    firstItem.focus();
    await user.keyboard("{Enter}");

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("marks the selected alert with aria-selected", () => {
    render(
      <AlertsSidebar alerts={ALERTS} selectedAlertId="ALT-0003" onAlertClick={vi.fn()} />
    );
    const items = screen.getAllByRole("listitem");
    const selected = items.find(i => i.getAttribute("aria-selected") === "true");
    expect(selected).toBeDefined();
    expect(within(selected!).getByText("FRS WATCHLIST")).toBeInTheDocument();
  });
});
