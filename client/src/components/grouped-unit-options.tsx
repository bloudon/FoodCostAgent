import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import type { Unit } from "@shared/schema";
import { formatUnitName } from "@/lib/utils";

const KIND_LABELS: Record<string, string> = {
  weight: "Weight",
  volume: "Volume",
  count: "Count",
};

const KIND_ORDER = ["weight", "volume", "count"];

interface GroupedUnitOptionsProps {
  units: Unit[];
}

export function GroupedUnitOptions({ units }: GroupedUnitOptionsProps) {
  return (
    <>
      {KIND_ORDER.map((kind) => {
        const kindUnits = units.filter((u) => u.kind === kind);
        if (kindUnits.length === 0) return null;
        return (
          <SelectGroup key={kind}>
            <SelectLabel>{KIND_LABELS[kind] ?? kind}</SelectLabel>
            {kindUnits.map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {formatUnitName(unit.name)}
              </SelectItem>
            ))}
          </SelectGroup>
        );
      })}
    </>
  );
}
