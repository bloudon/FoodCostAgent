// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { describe, expect, it, vi } from "vitest";
import { CountQuantityEditor } from "./count-session";

expect.extend(matchers);

describe("CountQuantityEditor package units", () => {
  it("labels bottle and canonical inputs explicitly and previews canonical quantity", () => {
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
        editingLooseUnits=""
        onFocus={vi.fn()}
        onQtyChange={vi.fn()}
        onCaseQtyChange={vi.fn()}
        onContainerQtyChange={onContainerQtyChange}
        onLooseUnitsChange={vi.fn()}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );

    expect(screen.getByText("bottles")).toBeInTheDocument();
    expect(screen.getByText("Loose ml")).toBeInTheDocument();
    expect(screen.getByText("= 4125.00 milliliter")).toBeInTheDocument();
    expect(screen.getByTestId("input-container-qty-wine")).toHaveAttribute("step", "0.01");

    fireEvent.change(screen.getByTestId("input-container-qty-wine"), {
      target: { value: "6" },
    });
    expect(onContainerQtyChange).toHaveBeenCalledWith("6");
  });
});