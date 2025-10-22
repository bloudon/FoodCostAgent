import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Key, Trash2, Edit, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface ApiCredential {
  id: string;
  name: string;
  description: string | null;
  apiKeyId: string;
  isActive: number;
  locationCount?: number;
  allowedIps: string[] | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface Store {
  id: string;
  name: string;
}

interface CredentialDetail extends ApiCredential {
  locations: Array<{ storeId: string; storeName: string }>;
}

interface NewCredentialResponse extends ApiCredential {
  secretKey: string;
  storeIds: string[];
  _warning: string;
}

export default function ApiCredentialsPage() {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [secretKeyDialogOpen, setSecretKeyDialogOpen] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<ApiCredential | null>(null);
  const [newCredentialData, setNewCredentialData] = useState<NewCredentialResponse | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [allowedIps, setAllowedIps] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Fetch credentials
  const { data: credentials, isLoading } = useQuery<ApiCredential[]>({
    queryKey: ["/api/api-credentials"],
  });

  // Fetch stores
  const { data: stores } = useQuery<Store[]>({
    queryKey: ["/api/stores/accessible"],
  });

  // Fetch credential detail
  const { data: credentialDetail } = useQuery<CredentialDetail>({
    queryKey: ["/api/api-credentials", selectedCredential?.id],
    enabled: !!selectedCredential && editDialogOpen,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; storeIds: string[]; allowedIps?: string[] }) => {
      return await apiRequest("POST", "/api/api-credentials", data) as Promise<NewCredentialResponse>;
    },
    onSuccess: (data: NewCredentialResponse) => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-credentials"] });
      setCreateDialogOpen(false);
      setNewCredentialData(data);
      setSecretKeyDialogOpen(true);
      resetForm();
      toast({
        title: "API Credential Created",
        description: "Save the secret key now - it won't be shown again!",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name?: string; description?: string; isActive?: number; allowedIps?: string[] }) => {
      const { id, ...updates } = data;
      return await apiRequest("PATCH", `/api/api-credentials/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-credentials"] });
      setEditDialogOpen(false);
      setSelectedCredential(null);
      resetForm();
      toast({
        title: "Success",
        description: "Credential updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/api-credentials/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-credentials"] });
      setDeleteDialogOpen(false);
      setSelectedCredential(null);
      toast({
        title: "Success",
        description: "Credential deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  // Update locations mutation
  const updateLocationsMutation = useMutation({
    mutationFn: async (data: { id: string; storeIds: string[] }) => {
      return await apiRequest("PUT", `/api/api-credentials/${data.id}/locations`, { storeIds: data.storeIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-credentials"] });
      toast({
        title: "Success",
        description: "Store locations updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setSelectedStores([]);
    setAllowedIps("");
    setIsActive(true);
  };

  const handleCreate = () => {
    if (!name.trim()) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Name is required",
      });
      return;
    }

    if (selectedStores.length === 0) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "At least one store location is required",
      });
      return;
    }

    const ips = allowedIps
      .split("\n")
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);

    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      storeIds: selectedStores,
      allowedIps: ips.length > 0 ? ips : undefined,
    });
  };

  const handleUpdate = () => {
    if (!selectedCredential) return;

    // Validate at least one store is selected
    if (selectedStores.length === 0) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "At least one store location is required",
      });
      return;
    }

    const ips = allowedIps
      .split("\n")
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);

    updateMutation.mutate({
      id: selectedCredential.id,
      name: name.trim() || undefined,
      description: description.trim() || undefined,
      isActive: isActive ? 1 : 0,
      allowedIps: ips.length > 0 ? ips : undefined,
    });

    // Always update locations with the complete selectedStores list
    const originalStoreIds = credentialDetail?.locations?.map(l => l.storeId) || [];
    const hasChanged = JSON.stringify([...selectedStores].sort()) !== JSON.stringify([...originalStoreIds].sort());
    
    if (hasChanged) {
      updateLocationsMutation.mutate({
        id: selectedCredential.id,
        storeIds: selectedStores,
      });
    }
  };

  const openEditDialog = async (credential: ApiCredential) => {
    setSelectedCredential(credential);
    setName(credential.name);
    setDescription(credential.description || "");
    setAllowedIps(credential.allowedIps?.join("\n") || "");
    setIsActive(credential.isActive === 1);
    setEditDialogOpen(true);
    
    // Fetch and seed selectedStores with current store IDs
    try {
      const detail = await queryClient.fetchQuery<CredentialDetail>({
        queryKey: ["/api/api-credentials", credential.id],
      });
      setSelectedStores(detail.locations?.map(l => l.storeId) || []);
    } catch (error) {
      console.error("Failed to fetch credential locations:", error);
      setSelectedStores([]);
    }
  };

  const openDeleteDialog = (credential: ApiCredential) => {
    setSelectedCredential(credential);
    setDeleteDialogOpen(true);
  };

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast({
      title: "Copied to clipboard",
      description: `${field} has been copied`,
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">API Credentials</h1>
          <p className="text-muted-foreground mt-2">Loading credentials...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">API Credentials</h1>
          <p className="text-muted-foreground mt-2">
            Manage HMAC authentication credentials for inbound data feeds (POS systems, vendor EDI)
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-credential">
          <Plus className="h-4 w-4 mr-2" />
          Create Credential
        </Button>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          API credentials allow external systems to securely send data to your inventory system. Each credential can access one or more store locations.
          Secret keys are only shown once at creation - save them securely!
        </AlertDescription>
      </Alert>

      <div className="grid gap-4">
        {credentials && credentials.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No API Credentials</h3>
              <p className="text-muted-foreground mb-4">
                Create your first API credential to enable inbound data feeds
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Credential
              </Button>
            </CardContent>
          </Card>
        )}

        {credentials?.map((credential) => (
          <Card key={credential.id} data-testid={`card-credential-${credential.id}`}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle>{credential.name}</CardTitle>
                    <Badge variant={credential.isActive ? "default" : "secondary"}>
                      {credential.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {credential.description && (
                    <CardDescription>{credential.description}</CardDescription>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => openEditDialog(credential)}
                    data-testid={`button-edit-${credential.id}`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => openDeleteDialog(credential)}
                    data-testid={`button-delete-${credential.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">API Key ID</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1 truncate">
                      {credential.apiKeyId}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => copyToClipboard(credential.apiKeyId, "API Key ID")}
                    >
                      {copiedField === "API Key ID" ? (
                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Store Locations</Label>
                  <p className="text-sm mt-1">{credential.locationCount || 0} locations</p>
                </div>
              </div>
              {credential.allowedIps && credential.allowedIps.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Allowed IPs</Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {credential.allowedIps.map((ip, idx) => (
                      <Badge key={idx} variant="outline" className="font-mono text-xs">
                        {ip}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {credential.lastUsedAt && (
                <div>
                  <Label className="text-xs text-muted-foreground">Last Used</Label>
                  <p className="text-sm mt-1">{new Date(credential.lastUsedAt).toLocaleString()}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create API Credential</DialogTitle>
            <DialogDescription>
              Create a new HMAC authentication credential for external system integration
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="create-name">Name *</Label>
              <Input
                id="create-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., POS System - Main Store"
                data-testid="input-name"
              />
            </div>
            <div>
              <Label htmlFor="create-description">Description</Label>
              <Textarea
                id="create-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
                data-testid="input-description"
              />
            </div>
            <div>
              <Label>Store Locations *</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Select which stores this credential can access
              </p>
              <div className="border rounded-md p-4 space-y-2 max-h-48 overflow-y-auto">
                {stores?.map((store) => (
                  <div key={store.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`create-store-${store.id}`}
                      checked={selectedStores.includes(store.id)}
                      onCheckedChange={(checked) => {
                        setSelectedStores(
                          checked
                            ? [...selectedStores, store.id]
                            : selectedStores.filter((id) => id !== store.id)
                        );
                      }}
                      data-testid={`checkbox-store-${store.id}`}
                    />
                    <Label htmlFor={`create-store-${store.id}`} className="font-normal cursor-pointer">
                      {store.name}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="create-ips">Allowed IP Addresses (Optional)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                One IP per line. Leave empty to allow all IPs.
              </p>
              <Textarea
                id="create-ips"
                value={allowedIps}
                onChange={(e) => setAllowedIps(e.target.value)}
                placeholder="10.0.0.1&#10;192.168.1.100"
                rows={4}
                className="font-mono text-xs"
                data-testid="input-allowed-ips"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-create">
              {createMutation.isPending ? "Creating..." : "Create Credential"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret Key Dialog (shown once after creation) */}
      <Dialog open={secretKeyDialogOpen} onOpenChange={setSecretKeyDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Save Your Secret Key</DialogTitle>
            <DialogDescription>
              This is the only time the secret key will be displayed. Save it securely!
            </DialogDescription>
          </DialogHeader>
          {newCredentialData && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {newCredentialData._warning}
                </AlertDescription>
              </Alert>
              <div>
                <Label>API Key ID</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs bg-muted px-3 py-2 rounded font-mono flex-1 break-all">
                    {newCredentialData.apiKeyId}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(newCredentialData.apiKeyId, "API Key ID")}
                  >
                    {copiedField === "API Key ID" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label>Secret Key</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs bg-destructive/10 px-3 py-2 rounded font-mono flex-1 break-all border-2 border-destructive/50">
                    {newCredentialData.secretKey}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(newCredentialData.secretKey, "Secret Key")}
                  >
                    {copiedField === "Secret Key" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSecretKeyDialogOpen(false)}>
              I've Saved the Secret Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit API Credential</DialogTitle>
            <DialogDescription>
              Update credential settings and store access
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-edit-name"
              />
            </div>
            <div>
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                data-testid="input-edit-description"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked as boolean)}
                data-testid="checkbox-active"
              />
              <Label htmlFor="edit-active" className="font-normal cursor-pointer">
                Active (credential can be used for authentication)
              </Label>
            </div>
            <div>
              <Label>Store Locations</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Update which stores this credential can access
              </p>
              <div className="border rounded-md p-4 space-y-2 max-h-48 overflow-y-auto">
                {stores?.map((store) => {
                  // Use selectedStores as single source of truth
                  const isSelected = selectedStores.includes(store.id);
                  return (
                    <div key={store.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`edit-store-${store.id}`}
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          setSelectedStores(
                            checked
                              ? [...selectedStores, store.id]
                              : selectedStores.filter((id) => id !== store.id)
                          );
                        }}
                        data-testid={`checkbox-edit-store-${store.id}`}
                      />
                      <Label htmlFor={`edit-store-${store.id}`} className="font-normal cursor-pointer">
                        {store.name}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <Label htmlFor="edit-ips">Allowed IP Addresses</Label>
              <p className="text-xs text-muted-foreground mb-2">
                One IP per line. Leave empty to allow all IPs.
              </p>
              <Textarea
                id="edit-ips"
                value={allowedIps}
                onChange={(e) => setAllowedIps(e.target.value)}
                rows={4}
                className="font-mono text-xs"
                data-testid="input-edit-allowed-ips"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending} data-testid="button-submit-edit">
              {updateMutation.isPending ? "Updating..." : "Update Credential"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete API Credential</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{selectedCredential?.name}"? This action cannot be undone.
              External systems using this credential will no longer be able to authenticate.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedCredential && deleteMutation.mutate(selectedCredential.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Credential"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
