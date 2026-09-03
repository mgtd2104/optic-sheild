import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, renderHook, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";
import * as apiClient from "../api/client";

// AuthContext talks to the backend through apiPost. We mock the network
// boundary so these tests exercise AuthContext's own logic (state
// transitions, localStorage persistence, error handling) without needing
// a running FastAPI server.
vi.mock("../api/client", () => ({
  apiPost: vi.fn(),
}));

const mockedApiPost = vi.mocked(apiClient.apiPost);

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe("AuthContext", () => {
  beforeEach(() => {
    mockedApiPost.mockReset();
    localStorage.clear();
  });

  it("starts unauthenticated with no stored session", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.hydrated).toBe(true));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("hydrates an existing session from localStorage on mount", async () => {
    localStorage.setItem("ibvap_token", "stored-token");
    localStorage.setItem(
      "ibvap_user",
      JSON.stringify({ name: "Op. Sharma", role: "Operator", bopLocation: "BOP-01" })
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.hydrated).toBe(true));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.name).toBe("Op. Sharma");
  });

  it("clears a corrupted stored session instead of crashing", async () => {
    localStorage.setItem("ibvap_token", "stored-token");
    localStorage.setItem("ibvap_user", "{not-valid-json");

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.hydrated).toBe(true));

    expect(result.current.isAuthenticated).toBe(false);
    expect(localStorage.getItem("ibvap_token")).toBeNull();
    expect(localStorage.getItem("ibvap_user")).toBeNull();
  });

  it("logs in successfully and persists the session", async () => {
    mockedApiPost.mockResolvedValueOnce({
      access_token: "jwt-123",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        user_id: "u1",
        username: "operator1",
        email: "op1@ibvap.mil",
        full_name: "Operator One",
      },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      await result.current.login({ username: "operator1", password: "secret" });
    });

    expect(mockedApiPost).toHaveBeenCalledWith("/api/auth/login", {
      username: "operator1",
      password: "secret",
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.name).toBe("Operator One");
    expect(result.current.error).toBeNull();
    expect(localStorage.getItem("ibvap_token")).toBe("jwt-123");
  });

  it("surfaces an error and stays unauthenticated on failed login", async () => {
    mockedApiPost.mockRejectedValueOnce(new Error("Invalid credentials"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      await expect(
        result.current.login({ username: "bad", password: "wrong" })
      ).rejects.toThrow("Invalid credentials");
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toBe("Invalid credentials");
    expect(localStorage.getItem("ibvap_token")).toBeNull();
  });

  it("registers a new user and auto-logs them in", async () => {
    mockedApiPost
      .mockResolvedValueOnce({
        user_id: "u2",
        username: "newop",
        email: "newop@ibvap.mil",
        full_name: "New Operator",
        created_at: "2026-09-01T00:00:00Z",
      })
      .mockResolvedValueOnce({
        access_token: "jwt-456",
        token_type: "bearer",
        expires_in: 3600,
        user: {
          user_id: "u2",
          username: "newop",
          email: "newop@ibvap.mil",
          full_name: "New Operator",
        },
      });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      await result.current.register({
        username: "newop",
        email: "newop@ibvap.mil",
        password: "secret123",
      });
    });

    expect(mockedApiPost).toHaveBeenNthCalledWith(1, "/api/auth/register", {
      username: "newop",
      email: "newop@ibvap.mil",
      password: "secret123",
    });
    expect(mockedApiPost).toHaveBeenNthCalledWith(2, "/api/auth/login", {
      username: "newop",
      password: "secret123",
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.name).toBe("New Operator");
  });

  it("logs out and clears the persisted session", async () => {
    mockedApiPost.mockResolvedValueOnce({
      access_token: "jwt-123",
      token_type: "bearer",
      expires_in: 3600,
      user: { user_id: "u1", username: "operator1", email: "op1@ibvap.mil", full_name: null },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      await result.current.login({ username: "operator1", password: "secret" });
    });
    expect(result.current.isAuthenticated).toBe(true);

    act(() => {
      result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem("ibvap_token")).toBeNull();
    expect(localStorage.getItem("ibvap_user")).toBeNull();
  });

  it("throws if useAuth is called outside of an AuthProvider", () => {
    // Swallow the expected React error-boundary console noise for this one case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Bare() {
      useAuth();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(
      "useAuth must be used within an AuthProvider"
    );
    spy.mockRestore();
  });
});
