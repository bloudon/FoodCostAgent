import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableFilterOption = {
  id: string;
  name: string;
};

type SearchableFilterSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableFilterOption[];
  allLabel: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  testId: string;
};

export function SearchableFilterSelect({
  value,
  onValueChange,
  options,
  allLabel,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  testId,
}: SearchableFilterSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.id === value);
  const selectedLabel = value === "all"
    ? allLabel
    : selectedOption?.name ?? placeholder;

  function select(nextValue: string) {
    onValueChange(nextValue);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`${placeholder} filter`}
          className="w-full justify-between font-normal sm:w-[180px]"
          data-testid={testId}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={allLabel} onSelect={() => select("all")}>
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === "all" ? "opacity-100" : "opacity-0",
                  )}
                />
                {allLabel}
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.name}
                  onSelect={() => select(option.id)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}