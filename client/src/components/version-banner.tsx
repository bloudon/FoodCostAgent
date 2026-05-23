import { useState } from "react";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { WhatsNewModal } from "@/components/whats-new-modal";

interface VersionBannerProps {
  currentVersion: string;
  userLastSeenVersion: string | null | undefined;
}

export function VersionBanner({ currentVersion, userLastSeenVersion }: VersionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const acknowledgeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/user/acknowledge-version"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const isNew = userLastSeenVersion !== currentVersion;
  if (!isNew || dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    acknowledgeMutation.mutate();
  }

  function handleSeeWhatsNew() {
    setModalOpen(true);
  }

  return (
    <>
      <div
        className="shrink-0 flex items-center gap-3 px-4 py-2 bg-primary/10 border-b text-sm"
        data-testid="version-banner"
      >
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <span className="flex-1 text-foreground">
          <span className="font-medium">FNB Cost Pro v{currentVersion} is here.</span>
          {" "}
          <button
            type="button"
            className="underline underline-offset-2 text-primary hover:text-primary/80 transition-colors"
            onClick={handleSeeWhatsNew}
            data-testid="button-see-whats-new"
          >
            See what&apos;s new
          </button>
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="shrink-0 h-6 w-6"
          onClick={handleDismiss}
          data-testid="button-dismiss-banner"
          aria-label="Dismiss update banner"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <WhatsNewModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        currentVersion={currentVersion}
        userLastSeenVersion={userLastSeenVersion}
      />
    </>
  );
}
