import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getMobileToken } from "@/hooks/use-embedded";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { useTier } from "@/hooks/use-tier";
import { Upload, FileText, CheckCircle2, AlertTriangle, Info, CheckSquare, Loader2, Check, RefreshCw, Lock, Pencil } from "lucide-react";

async function uploadMultipart(url: string, formData: FormData) {
  const mobileToken = getMobileToken();
  const headers: Record<string, string> = {};
  if (mobileToken) {
    headers["Authorization"] = `Bearer ${mobileToken}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) message = parsed.error;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

type Account = {
  id?: string;
  code: string;
  name: string;
  accountType: string | null;
  financialCategory?: string;
  operationalType?: string;
  isActive: number;
};

const MAPPING_FIELDS = [
  { key: "accountNumber", label: "Account Number", required: true },
  { key: "accountName", label: "Account Name", required: true },
  { key: "accountType", label: "Account Type (Revenue / Expense)", required: false },
  { key: "financialCategory", label: "Financial Category", required: false },
  { key: "operationalType", label: "Operational Type (Food/Bar/etc)", required: false },
];

export default function AccountingAccounts() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { meetsMinimum } = useTier();
  const [activeTab, setActiveTab] = useState("accounts");
  
  // Import state
  const [file, setFile] = useState<File | null>(null);
  const [headerRow, setHeaderRow] = useState<number>(1);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [applyExactMappings, setApplyExactMappings] = useState(true);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editValues, setEditValues] = useState({ accountType: "", financialCategory: "", operationalType: "" });
  const isCompanyAdmin = user?.role === "company_admin" || user?.role === "global_admin";
  const canAccess = isCompanyAdmin && meetsMinimum("enterprise");
  
  // Queries
  const { data: accounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounting/accounts", { includeInactive: true }],
    queryFn: async ({ queryKey }) => {
      // Using standard fetch pattern from queryClient
      const [, params] = queryKey as [string, { includeInactive: boolean }];
      const mobileToken = getMobileToken();
      const headers: Record<string, string> = mobileToken ? { "Authorization": `Bearer ${mobileToken}` } : {};
      const res = await fetch(`/api/accounting/accounts?includeInactive=${params.includeInactive}`, { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
    enabled: canAccess,
  });

  const previewMutation = useMutation({
    mutationFn: async (data: { file: File; headerRow: number; mapping: Record<string, string> }) => {
      const formData = new FormData();
      formData.append("file", data.file);
      formData.append("headerRow", data.headerRow.toString());
      formData.append("mapping", JSON.stringify(data.mapping));
      return await uploadMultipart("/api/accounting/imports/preview", formData);
    },
    onError: (err: Error) => {
      toast({ title: "Preview Failed", description: err.message, variant: "destructive" });
    }
  });

  const confirmMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const mobileToken = getMobileToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (mobileToken) headers["Authorization"] = `Bearer ${mobileToken}`;
      
      const res = await apiRequest("POST", `/api/accounting/imports/${sessionId}/confirm`, {
        applyExactCategoryMappings: applyExactMappings,
      });
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Import Successful", description: "Chart of accounts updated." });
      setFile(null);
      setMapping({});
      previewMutation.reset();
      setActiveTab("accounts");
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/accounts"] });
    },
    onError: (err: Error) => {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    }
  });

  const updateAccountMutation = useMutation({
    mutationFn: async () => {
      if (!editingAccount?.id) throw new Error("Account is missing an ID.");
      const response = await apiRequest("PATCH", `/api/accounting/accounts/${editingAccount.id}`, {
        accountType: editValues.accountType || null,
        financialCategory: editValues.financialCategory || null,
        operationalType: editValues.operationalType || null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/accounts"] });
      setEditingAccount(null);
      toast({ title: "Account classifications updated" });
    },
    onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
  });

  const openAccountEditor = (account: Account) => {
    setEditingAccount(account);
    setEditValues({
      accountType: account.accountType || "",
      financialCategory: account.financialCategory || "",
      operationalType: account.operationalType || "",
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    // Auto-trigger preview to get columns (mapping is likely empty)
    previewMutation.mutate({
      file: selectedFile,
      headerRow,
      mapping
    });
  };

  const handleRefreshPreview = () => {
    if (!file) return;
    previewMutation.mutate({
      file,
      headerRow,
      mapping
    });
  };

  const handleMappingChange = (key: string, value: string) => {
    setMapping(prev => ({ ...prev, [key]: value }));
  };

  const previewData = previewMutation.data;
  const columns = previewData?.columns || [];
  
  const isBayHillAcceptanceMatch =
    previewData?.summary?.createdAccounts === 34 &&
    previewData?.summary?.sentinelCreated === 1 &&
    previewData?.summary?.totalAccounts === 35 &&
    previewData?.summary?.categoriesMappable === 25 &&
    previewData?.summary?.categoriesTotal === 26 &&
    previewData?.summary?.operationalTypePopulated === 34 &&
    previewData?.summary?.categoryBreakdown?.Food === 15 &&
    previewData?.summary?.categoryBreakdown?.Bar === 11 &&
    previewData?.summary?.categoryBreakdown?.DOC === 7 &&
    previewData?.summary?.categoryBreakdown?.Other === 1 &&
    previewData?.summary?.rejectedRows === 0 &&
    previewData?.headerRow === 4;

  if (!canAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-4 pt-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-semibold">Enterprise administrator access required</h1>
            <p className="text-sm text-muted-foreground">
              Chart of Accounts import is available to company administrators on Enterprise plans.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-6xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chart of Accounts</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your enterprise chart of accounts and operational categories.
          </p>
        </div>
        {activeTab === "accounts" && (
          <Button onClick={() => setActiveTab("import")}>
            <Upload className="h-4 w-4 mr-2" />
            Import chart
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="accounts">Accounts Register</TabsTrigger>
          <TabsTrigger value="import">Import Data</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Current Chart of Accounts</CardTitle>
              <CardDescription>
                Review and audit your mapped accounts. The Operational Type column will feed the category split once the base-category workflow is complete.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accountsLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  Loading accounts...
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-12 border rounded-lg border-dashed">
                  <FileText className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">No accounts imported yet.</p>
                  <Button variant="outline" className="mt-4" onClick={() => setActiveTab("import")}>
                    Import chart
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account #</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Financial Category</TableHead>
                      <TableHead>Operational Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((acc: Account) => (
                      <TableRow key={acc.id || acc.code} className={acc.code === "999900" ? "bg-muted/50" : ""}>
                        <TableCell className="font-mono text-sm flex items-center gap-2">
                          {acc.code}
                          {acc.code === "999900" && (
                            <Badge variant="secondary" className="text-[10px] uppercase">Sentinel</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {acc.name}
                          {acc.code === "999900" && (
                            <span className="block text-xs text-muted-foreground font-normal">System-managed protected account</span>
                          )}
                        </TableCell>
                        <TableCell>{acc.accountType || "—"}</TableCell>
                        <TableCell>{acc.financialCategory || "—"}</TableCell>
                        <TableCell>{acc.operationalType || "—"}</TableCell>
                        <TableCell>
                          {acc.isActive ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {acc.code !== "999900" && (
                            <Button variant="ghost" size="sm" onClick={() => openAccountEditor(acc)}>
                              <Pencil className="mr-2 h-3.5 w-3.5" /> Classify
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Column: Upload & Mapping */}
            <div className="space-y-6 lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle>1. Select File</CardTitle>
                    <CardDescription>Upload a CSV or Excel file containing your chart of accounts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label>CSV or Excel file</Label>
                    <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} data-testid="input-accounting-import-file" />
                  </div>
                  {file && (
                    <div className="grid gap-2">
                      <Label>Header Row</Label>
                      <div className="flex gap-2">
                        <Input 
                          type="number" 
                          min={1} 
                          value={headerRow} 
                          onChange={(e) => setHeaderRow(parseInt(e.target.value) || 1)} 
                        />
                        <Button variant="outline" onClick={handleRefreshPreview} disabled={previewMutation.isPending}>
                          {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Adjust if your column names start below row 1.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {columns.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>2. Map Columns</CardTitle>
                    <CardDescription>Match source columns to the account fields</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {MAPPING_FIELDS.map((field) => (
                      <div key={field.key} className="grid gap-1.5">
                        <Label className="flex justify-between items-center text-sm">
                          {field.label}
                          {field.required && <span className="text-destructive text-[10px] uppercase">Required</span>}
                        </Label>
                        <Select 
                          value={mapping[field.key] || "none"} 
                          onValueChange={(val) => handleMappingChange(field.key, val === "none" ? "" : val)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select column..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">(None)</SelectItem>
                            {columns.map((c: string) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </CardContent>
                  <CardFooter>
                    <Button onClick={handleRefreshPreview} className="w-full" disabled={previewMutation.isPending}>
                      {previewMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Update Preview
                    </Button>
                  </CardFooter>
                </Card>
              )}
            </div>

            {/* Right Column: Preview & Action */}
            <div className="lg:col-span-2 space-y-6">
              {!previewData ? (
                <Card className="h-full min-h-[400px] flex items-center justify-center border-dashed bg-muted/20">
                  <div className="text-center">
                    <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground font-medium">No preview available</p>
                    <p className="text-xs text-muted-foreground mt-1">Select a file to generate a mapping preview</p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-6">
                  {/* Validation Summary */}
                  <Card>
                    <CardHeader className="pb-3 border-b">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>3. Review Import Preview</CardTitle>
                          <CardDescription>
                            File: <span className="font-mono font-medium text-foreground">{previewData.filename}</span>
                          </CardDescription>
                        </div>
                        {previewData.summary?.rejectedRows > 0 ? (
                          <Badge variant="destructive" className="h-7"><AlertTriangle className="h-3 w-3 mr-1" /> Issues Found</Badge>
                        ) : (
                          <Badge className="bg-green-600 hover:bg-green-700 h-7 text-white"><CheckCircle2 className="h-3 w-3 mr-1" /> Ready to Import</Badge>
                        )}
                      </div>
                    </CardHeader>
                    
                    {isBayHillAcceptanceMatch && (
                      <div className="px-6 pt-4">
                        <div className="bg-green-50/50 border border-green-200 rounded-lg p-4 dark:bg-green-900/10 dark:border-green-900/50">
                          <h4 className="text-green-800 dark:text-green-300 font-semibold mb-3 flex items-center gap-2">
                            <CheckSquare className="h-5 w-5" />
                            Bay Hill Acceptance Criteria Met
                          </h4>
                          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm text-green-700 dark:text-green-400">
                            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0"/> Header row 4</div>
                            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0"/> Accounts created: 34</div>
                            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0"/> Sentinel account: 1</div>
                            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0"/> Total accounts: 35</div>
                            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0"/> Categories: 25 of 26</div>
                            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0"/> Operational Type: 34 of 34</div>
                            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0"/> Food/Bar/DOC/Other: 15/11/7/1</div>
                            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0"/> Rejected: 0</div>
                          </div>
                        </div>
                      </div>
                    )}

                    <CardContent className="pt-6">
                      <div className="grid grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Valid Rows</p>
                          <p className="text-2xl font-semibold">{previewData.summary?.validRows || 0}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Rejected</p>
                          <p className={`text-2xl font-semibold ${previewData.summary?.rejectedRows > 0 ? "text-destructive" : ""}`}>
                            {previewData.summary?.rejectedRows || 0}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">New Accts</p>
                          <p className="text-2xl font-semibold text-primary">{previewData.summary?.createdAccounts || 0}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Unchanged</p>
                          <p className="text-2xl font-semibold">{previewData.summary?.unchangedAccounts || 0}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Categories</p>
                          <p className="text-2xl font-semibold text-blue-600 dark:text-blue-400">
                            {previewData.summary?.categoriesMappable || 0}
                          </p>
                        </div>
                      </div>

                      {/* Row Preview Table */}
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium">Row Preview (First 50)</h4>
                        <div className="border rounded-md overflow-hidden">
                          <Table>
                            <TableHeader className="bg-muted/50">
                              <TableRow>
                                <TableHead className="w-12">Row</TableHead>
                                <TableHead>Account</TableHead>
                                <TableHead>Category / Ops Type</TableHead>
                                <TableHead>Outcome</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(previewData.rows || []).slice(0, 50).map((row: any, idx: number) => (
                                <TableRow key={idx}>
                                  <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
                                  <TableCell>
                                    <div className="font-medium text-sm">{row.accountName}</div>
                                    <div className="text-xs font-mono text-muted-foreground">{row.accountNumber} &middot; {row.accountType}</div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm">{row.financialCategory || "—"}</div>
                                    <div className="text-xs text-muted-foreground">{row.operationalType || "—"}</div>
                                  </TableCell>
                                  <TableCell>
                                    {row.outcome === "created" ? (
                                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Will Create</Badge>
                                    ) : row.outcome === "unchanged" ? (
                                      <Badge variant="outline" className="text-muted-foreground">Unchanged</Badge>
                                    ) : row.outcome === "rejected" ? (
                                      <div className="flex flex-col items-start gap-1">
                                        <Badge variant="destructive">Rejected</Badge>
                                        <span className="text-[10px] text-destructive max-w-[150px] truncate" title={row.reason}>{row.reason}</span>
                                      </div>
                                    ) : (
                                      <Badge variant="outline">{row.outcome}</Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                              {(!previewData.rows || previewData.rows.length === 0) && (
                                <TableRow>
                                  <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                                    No rows parsed. Check your header row configuration.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      {previewData.categoryMappings?.length > 0 && (
                        <div className="mt-6 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-medium">Exact-name category mappings</h4>
                              <p className="text-xs text-muted-foreground">
                                Exact matches can be applied with confirmation. Remaining categories stay unchanged for human review.
                              </p>
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={applyExactMappings}
                                onChange={(event) => setApplyExactMappings(event.target.checked)}
                                data-testid="checkbox-apply-exact-category-mappings"
                              />
                              Apply reviewed exact matches
                            </label>
                          </div>
                          <div className="max-h-64 overflow-auto rounded-md border">
                            <Table>
                              <TableHeader className="bg-muted/50">
                                <TableRow>
                                  <TableHead>Inventory category</TableHead>
                                  <TableHead>Account</TableHead>
                                  <TableHead>Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {previewData.categoryMappings.map((item: any) => (
                                  <TableRow key={item.categoryId}>
                                    <TableCell>{item.categoryName}</TableCell>
                                    <TableCell>
                                      {item.accountNumber ? `${item.accountNumber} — ${item.accountName}` : "—"}
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant={item.status === "exact" || item.status === "sentinel" ? "outline" : "secondary"}>
                                        {item.status === "exact" ? "Exact match" : item.status === "sentinel" ? "Unassigned sentinel" : "Review required"}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="bg-muted/30 border-t pt-6 pb-6 flex flex-col gap-4 items-stretch sm:flex-row sm:justify-between sm:items-center">
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <Info className="h-4 w-4" />
                        Please review the exact outcomes above before confirming.
                      </div>
                      <Button 
                        size="lg"
                        disabled={!previewData.sessionId || previewData.summary?.rejectedRows > 0 || confirmMutation.isPending}
                        onClick={() => confirmMutation.mutate(previewData.sessionId)}
                        data-testid="button-confirm-accounting-import"
                      >
                        {confirmMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          <>
                            <Check className="h-4 w-4 mr-2" />
                            Confirm & Import Chart
                          </>
                        )}
                      </Button>
                    </CardFooter>
                  </Card>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editingAccount} onOpenChange={(open) => !open && setEditingAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Classify {editingAccount?.code}</DialogTitle>
            <DialogDescription>Assign fixed platform values when optional import columns were absent.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {[
              { key: "accountType", label: "Account Type", values: ["Revenue", "Expense"] },
              { key: "financialCategory", label: "Financial Category", values: ["Sales", "COGS", "Other Expense"] },
              { key: "operationalType", label: "Operational Type", values: ["Food", "Bar", "Direct Operating Cost", "Other"] },
            ].map(field => (
              <div className="grid gap-2" key={field.key}>
                <Label>{field.label}</Label>
                <Select
                  value={(editValues as any)[field.key] || "__none__"}
                  onValueChange={(value) => setEditValues(current => ({ ...current, [field.key]: value === "__none__" ? "" : value }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not assigned</SelectItem>
                    {field.values.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccount(null)}>Cancel</Button>
            <Button onClick={() => updateAccountMutation.mutate()} disabled={updateAccountMutation.isPending}>
              {updateAccountMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save classifications
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}