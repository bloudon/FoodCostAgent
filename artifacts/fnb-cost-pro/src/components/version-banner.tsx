import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { WhatsNewModal } from "@/components/whats-new-modal";

interface ChangelogEntry {
  version: string;
  date: string;
  sections: { heading: string; items: string[] }[];
}

interface VersionBannerProps {
  currentVersion: string;
  userLastSeenVersion: string | null | undefined;
  onAcknowledged?: () => void;
}

export function VersionBanner({ currentVersion, userLastSeenVersion, onAcknowledged }: VersionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const { data: entries } = useQuery<ChangelogEntry[]>({
    queryKey: ["/api/changelog"],
    enabled: userLastSeenVersion !== currentVersion && !dismissed,
    staleTime: Infinity,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/user/acknowledge-version"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      onAcknowledged?.();
    },
  });

  const isNew = userLastSeenVersion !== currentVersion;
  if (!isNew || dismissed) return null;

  const latestEntry = entries?.[0];
  const headline = latestEntry?.sections?.[0]?.heading ?? "New features and improvements";

  function handleDismiss() {
    setDismissed(true);
    acknowledgeMutation.mutate();
  }

  return (
    <>
      <div
        className="shrink-0 flex items-center gap-3 px-4 py-2 bg-primary/10 border-b text-sm"
        data-testid="version-banner"
      >
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <span className="flex-1 text-foreground">
          <span className="font-medium">v{currentVersion}: {headline}.</span>
          {" "}
          <button
            type="button"
            className="underline underline-offset-2 text-primary hover:text-primary/80 transition-colors"
            onClick={() => setModalOpen(true)}
            data-testid="button-see-whats-new"
          >
            See what&apos;s new
          </button>
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="shrink-0"
          onClick={handleDismiss}
          data-testid="button-dismiss-banner"
          aria-label="Dismiss update banner"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* WhatsNewModal handles its own acknowledge on close; we just dismiss the banner */}
      <WhatsNewModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setDismissed(true);
        }}
        currentVersion={currentVersion}
        userLastSeenVersion={userLastSeenVersion}
      />
    </>
  );
}
