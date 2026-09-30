// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { CountQuantityEditor } from "./count-session";

expect.extend(matchers);
afterEach(cleanup);

describe("CountQuantityEditor package units", () => {
  it("counts cases and fractional bottles without exposing canonical inputs", () => {
    const onContainerQtyChange = vi.fn();
    render(
      <CountQuantityEditor
        line={{ id: "wine", caseQty: null, containerQty: null, looseUnits: null }}
        item={{
          containerSize: 750,
          casePkgCount: 12,
          containerLabel: "bottle",
          unitName: "milliliter",
          unitAbbreviation: "ml",
        }}
        mode="case"
        isEditing
        editingQty=""
        editingCaseQty=""
        editingContainerQty="5.5"
        onFocus={vi.fn()}
        onQtyChange={vi.fn()}
        onCaseQtyChange={vi.fn()}
        onContainerQtyChange={onContainerQtyChange}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );

    expect(screen.getByText("bottles")).toBeInTheDocument();
    expect(screen.queryByText("Loose ml")).not.toBeInTheDocument();
    expect(screen.queryByTestId("input-loose-units-wine")).not.toBeInTheDocument();
    expect(screen.getByText("= 5.50 bottles")).toBeInTheDocument();
    expect(screen.getByTestId("input-container-qty-wine")).toHaveAttribute("step", "0.01");

    fireEvent.change(screen.getByTestId("input-container-qty-wine"), {
      target: { value: "6" },
    });
    expect(onContainerQtyChange).toHaveBeenCalledWith("6");
  });

  it("uses a neutral container label when numeric package geometry is complete", () => {
    render(
      <CountQuantityEditor
        line={{ id: "unconfigured", caseQty: null, containerQty: null, looseUnits: null }}
        item={{
          containerSize: 750,
          casePkgCount: 12,
          containerLabel: null,
          unitName: "milliliter",
          unitAbbreviation: "ml",
        }}
        mode="case"
        isEditing={false}
        editingQty=""
        editingCaseQty=""
        editingContainerQty=""
        onFocus={vi.fn()}
        onQtyChange={vi.fn()}
        onCaseQtyChange={vi.fn()}
        onContainerQtyChange={vi.fn()}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );

    expect(screen.getByTestId("input-case-qty-unconfigured")).toBeInTheDocument();
    expect(screen.getByTestId("input-container-qty-unconfigured")).toBeInTheDocument();
    expect(screen.getByText("containers")).toBeInTheDocument();
    expect(screen.queryByText("Milliliters")).not.toBeInTheDocument();
  });

  it("preserves a historical canonical remainder without making it editable", () => {
    render(
      <CountQuantityEditor
        line={{ id: "historical", caseQty: 0, containerQty: 0, looseUnits: 12.25 }}
        item={{
          containerSize: 750,
          casePkgCount: 12,
          containerLabel: "bottle",
          unitName: "milliliter",
          unitAbbreviation: "ml",
        }}
        mode="case"
        isEditing={false}
        editingQty=""
        editingCaseQty=""
        editingContainerQty=""
        onFocus={vi.fn()}
        onQtyChange={vi.fn()}
        onCaseQtyChange={vi.fn()}
        onContainerQtyChange={vi.fn()}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );

    expect(screen.getByTestId("historical-loose-count-historical")).toHaveTextContent(
      "Historical count preserved: 12.25 ml",
    );
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("does not prefill editable package inputs from a count in older canonical units", () => {
    render(
      <CountQuantityEditor
        line={{ id: "old-unit", qty: 750, unitId: "prior-ml", unitAbbreviation: "mL", caseQty: 0, containerQty: 1, looseUnits: 0 }}
        item={{
          unitId: "current-ml", containerSize: 750, casePkgCount: 12,
          containerLabel: "bottle", unitName: "milliliter",
        }}
        mode="case"
        isEditing={false}
        editingQty=""
        editingCaseQty=""
        editingContainerQty=""
        onFocus={vi.fn()}
        onQtyChange={vi.fn()}
        onCaseQtyChange={vi.fn()}
        onContainerQtyChange={vi.fn()}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId("input-case-qty-old-unit")).toHaveValue(null);
    expect(screen.getByTestId("input-container-qty-old-unit")).toHaveValue(null);
  });
});