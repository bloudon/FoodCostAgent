import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Calendar } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export default function VarianceReport() {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const [startDate, setStartDate] = useState(sevenDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);

  const { data: variance, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/reports/variance", startDate, endDate],
    queryFn: async () => {
      const response = await fetch(`/api/reports/variance?start=${startDate}&end=${endDate}`);
      if (!response.ok) throw new Error("Failed to fetch variance");
      return response.json();
    },
    enabled: false,
  });

  const totalVariance = variance?.reduce((sum, v) => sum + (v.varianceCost || 0), 0) || 0;
  const positiveVariance = variance?.reduce((sum, v) => v.varianceCost < 0 ? sum + Math.abs(v.varianceCost) : sum, 0) || 0;
  const negativeVariance = variance?.reduce((sum, v) => v.varianceCost > 0 ? sum + v.varianceCost : sum, 0) || 0;

  const stats = [
    {
      title: "Total Variance",
      value: `$${Math.abs(totalVariance).toFixed(2)}`,
      description: "Actual vs. theoretical",
    },
    {
      title: "Positive Variance",
      value: `$${positiveVariance.toFixed(2)}`,
      description: "Lower usage than expected",
    },
    {
      title: "Negative Variance",
      value: `$${negativeVariance.toFixed(2)}`,
      description: "Higher usage than expected",
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-variance-title">
            Variance Report
          </h1>
          <p className="text-muted-foreground mt-2">
            Compare theoretical vs. actual usage by product and period
          </p>
        </div>
        <Button variant="outline" data-testid="button-export-report">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      <div className="mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4 items-end flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-2 block">Start Date</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  data-testid="input-start-date"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-2 block">End Date</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  data-testid="input-end-date"
                />
              </div>
              <Button onClick={() => refetch()} disabled={isLoading} data-testid="button-generate-report">
                <Calendar className="h-4 w-4 mr-2" />
                {isLoading ? "Generating..." : "Generate Report"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3 mb-6">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono" data-testid={`text-${stat.title.toLowerCase().replace(/\s+/g, "-")}`}>
                {stat.value}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Variance by Product</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Theoretical Usage</TableHead>
                <TableHead className="text-right">Actual Usage</TableHead>
                <TableHead className="text-right">Variance (Units)</TableHead>
                <TableHead className="text-right">Variance (Cost)</TableHead>
                <TableHead className="text-right">Variance %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : variance && variance.length > 0 ? (
                variance.map((row) => (
                  <TableRow key={row.productId} className="hover-elevate" data-testid={`row-variance-${row.productId}`}>
                    <TableCell className="font-medium" data-testid={`text-variance-product-${row.productId}`}>{row.productName}</TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-variance-theoretical-${row.productId}`}>{row.theoreticalUsage.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-variance-actual-${row.productId}`}>{row.actualUsage.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-variance-units-${row.productId}`}>{row.varianceUnits.toFixed(2)}</TableCell>
                    <TableCell className={`text-right font-mono font-semibold ${row.varianceCost > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`} data-testid={`text-variance-cost-${row.productId}`}>
                      ${Math.abs(row.varianceCost).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-variance-percent-${row.productId}`}>{row.variancePercent.toFixed(1)}%</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No variance data available. Select a date range and generate a report.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
