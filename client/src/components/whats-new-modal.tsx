import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ChangelogEntry {
  version: string;
  date: string;
  sections: { heading: string; items: string[] }[];
}

interface WhatsNewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentVersion: string;
  userLastSeenVersion: string | null | undefined;
}

export function WhatsNewModal({ open, onOpenChange, currentVersion, userLastSeenVersion }: WhatsNewModalProps) {
  const { data: entries = [], isLoading } = useQuery<ChangelogEntry[]>({
    queryKey: ["/api/changelog"],
    enabled: open,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/user/acknowledge-version"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      if (userLastSeenVersion !== currentVersion) {
        acknowledgeMutation.mutate();
      }
    }
    onOpenChange(isOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col" data-testid="dialog-whats-new">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            What&apos;s New
            <Badge variant="secondary" className="text-xs font-mono">v{currentVersion}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-6 mt-2">
          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-4 bg-muted rounded animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && entries.map((entry, idx) => (
            <div key={entry.version} className="space-y-3">
              {idx > 0 && <Separator />}
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm font-mono">v{entry.version}</span>
                {entry.date && (
                  <span className="text-xs text-muted-foreground">{entry.date}</span>
                )}
                {entry.version === currentVersion && (
                  <Badge variant="outline" className="text-xs ml-auto">Current</Badge>
                )}
              </div>
              {entry.sections.map((section) => (
                <div key={section.heading} className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {section.heading}
                  </p>
                  <ul className="space-y-1">
                    {section.items.map((item, i) => (
                      <li key={i} className="text-sm flex gap-2">
                        <span className="text-muted-foreground mt-1 shrink-0">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
