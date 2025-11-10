import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar, Download } from "lucide-react";

export default function TfcVariance() {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-variance-title">
            Food Cost Variance
          </h1>
          <p className="text-muted-foreground mt-2">
            Compare theoretical vs. actual ingredient usage and cost
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
                  defaultValue={sevenDaysAgo.toISOString().split('T')[0]}
                  data-testid="input-start-date"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-2 block">End Date</label>
                <Input
                  type="date"
                  defaultValue={now.toISOString().split('T')[0]}
                  data-testid="input-end-date"
                />
              </div>
              <Button data-testid="button-generate-report">
                <Calendar className="h-4 w-4 mr-2" />
                Generate Report
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3 mb-6">
        {[
          { title: "Total Variance", value: "-", description: "Actual vs. theoretical" },
          { title: "Positive Variance", value: "-", description: "Lower usage than expected" },
          { title: "Negative Variance", value: "-", description: "Higher usage than expected" },
        ].map((stat) => (
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
          <CardTitle className="text-lg">Variance by Ingredient</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No data available</p>
            <p className="text-sm mt-1">Upload sales data and generate a report to see variance details</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
