import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Download } from "lucide-react";

export default function TfcSalesImport() {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      console.log("File dropped:", file.name);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-sales-import-title">
          Sales Import
        </h1>
        <p className="text-muted-foreground mt-2">
          Upload CSV sales data to calculate theoretical food cost and variance
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Upload CSV File</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                data-testid="dropzone-csv"
              >
                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm font-medium mb-2">
                  Drag and drop your CSV file here
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  or click to browse
                </p>
                <Button variant="outline" size="sm" data-testid="button-browse-file">
                  <FileText className="h-4 w-4 mr-2" />
                  Browse Files
                </Button>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <Download className="h-4 w-4 text-muted-foreground" />
                <a
                  href="#"
                  className="text-primary hover:underline"
                  data-testid="link-download-template"
                >
                  Download CSV template
                </a>
              </div>

              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="font-medium mb-2">CSV Format Requirements:</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• date (YYYY-MM-DD)</li>
                  <li>• store_code</li>
                  <li>• plu_sku</li>
                  <li>• qty_sold</li>
                  <li>• net_sales</li>
                  <li>• daypart (optional)</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Uploads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center text-muted-foreground py-8">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No uploads yet</p>
                <p className="text-sm mt-1">Upload a CSV file to get started</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
