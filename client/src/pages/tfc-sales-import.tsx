import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Download, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function TfcSalesImport() {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

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
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelection = (file: File) => {
    // Validate file type
    if (!file.name.endsWith('.csv')) {
      setUploadError("Please select a CSV file");
      setSelectedFile(null);
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File size must be less than 10MB");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setUploadError(null);
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelection(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch('/api/tfc/sales/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        
        // If we have detailed validation errors, show them
        if (error.errors && Array.isArray(error.errors)) {
          const errorList = error.errors.slice(0, 5).join('\n');
          const moreErrors = error.errors.length > 5 ? `\n...and ${error.errors.length - 5} more errors` : '';
          throw new Error(`CSV Validation Errors:\n${errorList}${moreErrors}`);
        }
        
        throw new Error(error.message || 'Upload failed');
      }

      const result = await response.json();
      
      toast({
        title: "Upload Successful",
        description: `Processed ${result.recordCount || 0} sales records`,
      });

      // Reset form
      setSelectedFile(null);
      setUploadError(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

    } catch (error: any) {
      setUploadError(error.message || 'Failed to upload file');
      toast({
        title: "Upload Failed",
        description: error.message || 'An error occurred',
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    const csvContent = "date,store_code,plu_sku,qty_sold,net_sales,daypart\n2024-11-10,s00A,CAPRESE,25,323.75,Dinner\n2024-11-10,s00B,MARGHERITA,18,233.10,Lunch";
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sales_import_template.csv';
    link.click();
    window.URL.revokeObjectURL(url);
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileInputChange}
                className="hidden"
                data-testid="input-file"
              />
              
              <div
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={handleBrowseClick}
                data-testid="dropzone-csv"
              >
                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm font-medium mb-2">
                  Drag and drop your CSV file here
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  or click to browse
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleBrowseClick();
                  }}
                  data-testid="button-browse-file"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Browse Files
                </Button>
              </div>

              {selectedFile && (
                <Alert className="bg-muted">
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(2)} KB
                        </p>
                      </div>
                      <Button 
                        onClick={handleUpload}
                        disabled={uploading}
                        data-testid="button-upload"
                      >
                        {uploading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 mr-2" />
                            Upload
                          </>
                        )}
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {uploadError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{uploadError}</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center gap-2 text-sm">
                <Download className="h-4 w-4 text-muted-foreground" />
                <button
                  onClick={downloadTemplate}
                  className="text-primary hover:underline"
                  data-testid="link-download-template"
                >
                  Download CSV template
                </button>
              </div>

              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="font-medium mb-2">CSV Format Requirements:</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• <strong>date</strong> (YYYY-MM-DD)</li>
                  <li>• <strong>store_code</strong> (e.g., s00A, s00B)</li>
                  <li>• <strong>plu_sku</strong> (menu item SKU)</li>
                  <li>• <strong>qty_sold</strong> (number)</li>
                  <li>• <strong>net_sales</strong> (dollar amount)</li>
                  <li>• <strong>daypart</strong> (optional: Breakfast, Lunch, Dinner, Late Night)</li>
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
