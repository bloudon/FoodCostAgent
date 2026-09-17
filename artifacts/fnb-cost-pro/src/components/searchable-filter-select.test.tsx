// @vitest-environment jsdom
import React from "react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SearchableFilterSelect } from "./searchable-filter-select";

expect.extend(matchers);

beforeAll(() => {
  if (!global.ResizeObserver) {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const options = [
  { id: "beer", name: "Canned Beer" },
  { id: "wine", name: "Wine" },
  { id: "spirits", name: "Spirits" },
];

function renderFilter(
  value = "all",
  onValueChange = vi.fn(),
) {
  render(
    <SearchableFilterSelect
      value={value}
      onValueChange={onValueChange}
      options={options}
      allLabel="All Categories"
      placeholder="Category"
      searchPlaceholder="Search categories..."
      emptyMessage="No categories found."
      testId="category-filter"
    />,
  );
  return onValueChange;
}

async function openFilter() {
  fireEvent.click(screen.getByTestId("category-filter"));
  await waitFor(() => {
    expect(screen.getByPlaceholderText("Search categories...")).toBeInTheDocument();
  });
}

describe("SearchableFilterSelect", () => {
  it("opens with the full option list and accessible combobox state", async () => {
    renderFilter();
    const trigger = screen.getByTestId("category-filter");

    expect(trigger).toHaveAttribute("role", "combobox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await openFilter();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("All Categories")).toHaveLength(2);
    expect(screen.getByText("Canned Beer")).toBeInTheDocument();
    expect(screen.getByText("Wine")).toBeInTheDocument();
    expect(screen.getByText("Spirits")).toBeInTheDocument();
  });

  it("narrows options by typed name without selecting", async () => {
    const onValueChange = renderFilter();
    await openFilter();

    fireEvent.change(screen.getByPlaceholderText("Search categories..."), {
      target: { value: "canned" },
    });

    await waitFor(() => expect(screen.getByText("Canned Beer")).toBeInTheDocument());
    expect(screen.queryByText("Wine")).not.toBeInTheDocument();
    expect(screen.queryByText("Spirits")).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("shows an empty message when no option matches", async () => {
    renderFilter();
    await openFilter();

    fireEvent.change(screen.getByPlaceholderText("Search categories..."), {
      target: { value: "not-a-category" },
    });

    await waitFor(() => {
      expect(screen.getByText("No categories found.")).toBeInTheDocument();
    });
  });

  it("selects an option and closes the dropdown", async () => {
    const onValueChange = renderFilter();
    await openFilter();

    fireEvent.click(screen.getByText("Wine"));

    expect(onValueChange).toHaveBeenCalledWith("wine");
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search categories...")).not.toBeInTheDocument();
    });
  });

  it("selects the narrowed option with the keyboard", async () => {
    const onValueChange = renderFilter();
    await openFilter();
    const input = screen.getByPlaceholderText("Search categories...");

    fireEvent.change(input, { target: { value: "spirits" } });
    await waitFor(() => expect(screen.getByText("Spirits")).toBeInTheDocument());
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onValueChange).toHaveBeenCalledWith("spirits");
  });

  it("allows a selected filter to be cleared back to all", async () => {
    const onValueChange = renderFilter("wine");
    expect(screen.getByTestId("category-filter")).toHaveTextContent("Wine");
    await openFilter();

    fireEvent.click(screen.getByText("All Categories"));

    expect(onValueChange).toHaveBeenCalledWith("all");
  });
});