import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, RefreshCw, Unlock, Clock, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface StuckJob {
  id: string;
  connectionId: string;
  companyId: string;
  jobType: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  daysBackfilled: number | null;
  rowsIngested: number;
  rowsSkipped: number;
  errorMessage: string | null;
  createdAt: string;
  merchantId: string;
  connectionStatus: string;
}

function formatAge(startedAt: string | null): string {
  if (!startedAt) return "unknown";
  const ms = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return remainingMin > 0 ? `${hours}h ${remainingMin}m` : `${hours}h`;
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString();
}

export default function AdminPosSyncJobs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<{ jobs: StuckJob[] }>({
    queryKey: ["/api/admin/pos-sync-jobs/stuck"],
    refetchInterval: 60_000, // auto-refresh every 60s
  });

  const releaseMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return apiRequest("POST", `/api/admin/pos-sync-jobs/${jobId}/release`, {});
    },
    onSuccess: (_data, jobId) => {
      toast({
        title: "Job released",
        description: `Sync job ${jobId.slice(0, 8)}… has been marked as failed, releasing its lock.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pos-sync-jobs/stuck"] });
      setReleasingId(null);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to release job",
        description: err?.message ?? "An unexpected error occurred.",
        variant: "destructive",
      });
      setReleasingId(null);
    },
  });

  if (user?.role !== "global_admin") {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Global admin access required.</p>
      </div>
    );
  }

  const jobs = data?.jobs ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            Stuck POS Sync Jobs
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Running jobs that started more than 30 minutes ago. Releasing a job marks it as
            failed and frees the lock so future syncs can proceed.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading stuck jobs…
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No stuck jobs</p>
            <p className="text-sm mt-1">
              All POS sync jobs are completing normally (or none are running).
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-amber-600 font-medium">
            {jobs.length} stuck job{jobs.length !== 1 ? "s" : ""} found
          </p>
          {jobs.map((job) => (
            <Card key={job.id} className="border-amber-200 dark:border-amber-900">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-base font-mono text-xs text-muted-foreground truncate">
                      {job.id}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="capitalize">
                        {job.jobType}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-300"
                      >
                        running {formatAge(job.startedAt)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          job.connectionStatus === "active"
                            ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-300"
                            : "border-gray-300 text-gray-600"
                        }
                      >
                        connection: {job.connectionStatus}
                      </Badge>
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shrink-0 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950"
                        disabled={releasingId === job.id || releaseMutation.isPending}
                        onClick={() => setReleasingId(job.id)}
                      >
                        {releasingId === job.id && releaseMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5" />
                        )}
                        Release
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Release stuck job?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will mark job <code className="font-mono text-xs">{job.id}</code> as{" "}
                          <strong>failed</strong> and release its sync lock. Future syncs for
                          connection <code className="font-mono text-xs">{job.connectionId}</code>{" "}
                          (merchant <code className="font-mono text-xs">{job.merchantId}</code>) will
                          be able to run normally.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setReleasingId(null)}>
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => releaseMutation.mutate(job.id)}
                          className="bg-amber-600 hover:bg-amber-700"
                        >
                          Release lock
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Merchant</dt>
                    <dd className="font-mono text-xs truncate">{job.merchantId}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Company</dt>
                    <dd className="font-mono text-xs truncate">{job.companyId}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Started at</dt>
                    <dd className="text-xs">{formatDate(job.startedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Rows ingested</dt>
                    <dd className="text-xs">{job.rowsIngested}</dd>
                  </div>
                  {job.daysBackfilled != null && (
                    <div>
                      <dt className="text-muted-foreground text-xs">Days backfilled</dt>
                      <dd className="text-xs">{job.daysBackfilled}</dd>
                    </div>
                  )}
                  {job.errorMessage && (
                    <div className="col-span-2 sm:col-span-4">
                      <dt className="text-muted-foreground text-xs">Last error</dt>
                      <dd className="text-xs text-destructive truncate">{job.errorMessage}</dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
