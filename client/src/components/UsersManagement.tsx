import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAccessibleStores } from "@/hooks/use-accessible-stores";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { User, CompanyStore } from "@shared/schema";
import { UserPlus, Pencil, Trash2, Mail, X, Copy } from "lucide-react";
import type { Invitation } from "@shared/schema";

export function UsersManagement({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(new Set());
  const [createUserRole, setCreateUserRole] = useState<string>("store_user");
  const [inviteRole, setInviteRole] = useState<string>("store_user");

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/users?companyId=${companyId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return await res.json();
    },
  });

  const { data: stores = [] } = useAccessibleStores();

  // Fetch store assignments for the selected user
  const { data: userStoreAssignments = [] } = useQuery<Array<{ id: string; userId: string; storeId: string }>>({
    queryKey: ["/api/users", selectedUser?.id, "stores"],
    queryFn: async () => {
      if (!selectedUser) return [];
      const res = await fetch(`/api/users/${selectedUser.id}/stores`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return await res.json();
    },
    enabled: !!selectedUser && editDialogOpen,
  });

  // Update controlled checkbox state when store assignments load
  useEffect(() => {
    if (selectedUser && editDialogOpen) {
      const newStoreIds = new Set(userStoreAssignments.map(assignment => assignment.storeId));
      setSelectedStoreIds(newStoreIds);
    }
  }, [selectedUser?.id, editDialogOpen]);

  const createUserMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", companyId] });
      setCreateDialogOpen(false);
      toast({
        title: "Success",
        description: "User created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return await apiRequest("PATCH", `/api/users/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", companyId] });
      setEditDialogOpen(false);
      setSelectedUser(null);
      toast({
        title: "Success",
        description: "User updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user",
        variant: "destructive",
      });
    },
  });

  // Invitation queries and mutations
  const { data: invitations = [] } = useQuery<Invitation[]>({
    queryKey: ["/api/invitations", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/invitations?companyId=${companyId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return await res.json();
    },
  });

  const createInvitationMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/invitations", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations", companyId] });
      setInviteDialogOpen(false);
      toast({
        title: "Success",
        description: "Invitation sent successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send invitation",
        variant: "destructive",
      });
    },
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/invitations/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations", companyId] });
      toast({
        title: "Success",
        description: "Invitation revoked successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to revoke invitation",
        variant: "destructive",
      });
    },
  });

  const handleCreateUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const role = formData.get("role") as string;
    const storeIds = stores
      .filter((store) => formData.get(`store-${store.id}`) === "on")
      .map((store) => store.id);

    // Validate store selection for store_user and store_manager
    if ((role === "store_user" || role === "store_manager") && storeIds.length === 0) {
      toast({
        title: "Validation Error",
        description: "Store Users and Store Managers must be assigned to at least 1 store",
        variant: "destructive",
      });
      return;
    }

    createUserMutation.mutate({
      email: formData.get("email"),
      password: formData.get("password"),
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      role: role,
      companyId: companyId,
      storeIds,
    });
  };

  const handleUpdateUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedUser) return;

    const formData = new FormData(e.currentTarget);
    const role = formData.get("role") as string;
    const storeIds = Array.from(selectedStoreIds);

    // Validate store selection for store_user and store_manager
    if ((role === "store_user" || role === "store_manager") && storeIds.length === 0) {
      toast({
        title: "Validation Error",
        description: "Store Users and Store Managers must be assigned to at least 1 store",
        variant: "destructive",
      });
      return;
    }

    const updates: any = {
      email: formData.get("email"),
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      role: role,
      active: formData.get("active") === "1" ? 1 : 0,
      storeIds: storeIds,
    };

    const password = formData.get("password") as string;
    if (password) {
      updates.password = password;
    }

    updateUserMutation.mutate({ id: selectedUser.id, data: updates });
  };

  const handleStoreToggle = (storeId: string) => {
    setSelectedStoreIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(storeId)) {
        newSet.delete(storeId);
      } else {
        newSet.add(storeId);
      }
      return newSet;
    });
  };

  const handleSendInvitation = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const invitationData = {
      email: formData.get("email"),
      role: formData.get("role"),
      companyId,
    };
    
    createInvitationMutation.mutate(invitationData);
  };

  const handleCopyInvitationLink = (token: string) => {
    const inviteUrl = `${window.location.origin}/accept-invitation/${token}`;
    navigator.clipboard.writeText(inviteUrl);
    toast({
      title: "Success",
      description: "Invitation link copied to clipboard",
    });
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "global_admin":
        return "default";
      case "company_admin":
        return "secondary";
      case "store_manager":
        return "outline";
      default:
        return "outline";
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "global_admin":
        return "Global Admin";
      case "company_admin":
        return "Company Admin";
      case "store_manager":
        return "Store Manager";
      case "store_user":
        return "Store User";
      default:
        return role;
    }
  };

  if (isLoading) {
    return <div>Loading users...</div>;
  }

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>User Management</CardTitle>
            <CardDescription>
              Manage users and their roles within your company
            </CardDescription>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={(open) => {
            setCreateDialogOpen(open);
            if (!open) {
              setCreateUserRole("store_user");
            }
          }}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-user">
                <UserPlus className="h-4 w-4 mr-2" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
                <DialogDescription>
                  Add a new user to your company
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateUser}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" required data-testid="input-email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" name="password" type="password" required data-testid="input-password" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input id="firstName" name="firstName" data-testid="input-firstName" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input id="lastName" name="lastName" data-testid="input-lastName" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select name="role" defaultValue="store_user" onValueChange={setCreateUserRole} required>
                      <SelectTrigger data-testid="select-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="company_admin">Company Admin</SelectItem>
                        <SelectItem value="store_manager">Store Manager</SelectItem>
                        <SelectItem value="store_user">Store User</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {stores.length > 0 && (
                    <div className="space-y-2">
                      <Label>
                        Store Assignments
                        {(createUserRole === "store_user" || createUserRole === "store_manager") && (
                          <span className="text-destructive ml-1">*</span>
                        )}
                      </Label>
                      <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                        {stores.map((store) => (
                          <div key={store.id} className="flex items-center space-x-2">
                            <Checkbox id={`store-${store.id}`} name={`store-${store.id}`} data-testid={`checkbox-store-${store.id}`} />
                            <Label htmlFor={`store-${store.id}`} className="text-sm font-normal cursor-pointer">
                              {store.name}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-submit-create">
                    {createUserMutation.isPending ? "Creating..." : "Create User"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                  <TableCell>
                    {user.firstName || user.lastName
                      ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
                      : "—"}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={getRoleBadgeVariant(user.role)}>
                      {getRoleLabel(user.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.active === 1 ? "default" : "outline"}>
                      {user.active === 1 ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedUser(user);
                        setEditDialogOpen(true);
                      }}
                      data-testid={`button-edit-user-${user.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Edit User Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) {
            setSelectedUser(null);
            setSelectedStoreIds(new Set());
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
              <DialogDescription>
                Update user information and permissions
              </DialogDescription>
            </DialogHeader>
            {selectedUser && (
              <form onSubmit={handleUpdateUser}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-email">Email</Label>
                    <Input id="edit-email" name="email" type="email" defaultValue={selectedUser.email} required data-testid="input-edit-email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-password">Password (leave blank to keep current)</Label>
                    <Input id="edit-password" name="password" type="password" data-testid="input-edit-password" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-firstName">First Name</Label>
                      <Input id="edit-firstName" name="firstName" defaultValue={selectedUser.firstName || ""} data-testid="input-edit-firstName" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-lastName">Last Name</Label>
                      <Input id="edit-lastName" name="lastName" defaultValue={selectedUser.lastName || ""} data-testid="input-edit-lastName" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-role">Role</Label>
                    <Select name="role" defaultValue={selectedUser.role} required>
                      <SelectTrigger data-testid="select-edit-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="company_admin">Company Admin</SelectItem>
                        <SelectItem value="store_manager">Store Manager</SelectItem>
                        <SelectItem value="store_user">Store User</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-active">Status</Label>
                    <Select name="active" defaultValue={selectedUser.active?.toString() || "1"}>
                      <SelectTrigger data-testid="select-edit-active">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Active</SelectItem>
                        <SelectItem value="0">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {stores.length > 0 && (
                    <div className="space-y-2">
                      <Label>Store Assignments</Label>
                      <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                        {stores.map((store) => (
                          <div key={store.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`edit-store-${store.id}`}
                              checked={selectedStoreIds.has(store.id)}
                              onCheckedChange={() => handleStoreToggle(store.id)}
                              data-testid={`checkbox-edit-store-${store.id}`}
                            />
                            <Label htmlFor={`edit-store-${store.id}`} className="text-sm font-normal cursor-pointer">
                              {store.name}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={updateUserMutation.isPending} data-testid="button-submit-edit">
                    {updateUserMutation.isPending ? "Updating..." : "Update User"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>

    {/* Pending Invitations Card */}
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Pending Invitations</CardTitle>
            <CardDescription>
              Invite new users to join your company via email
            </CardDescription>
          </div>
          <Dialog open={inviteDialogOpen} onOpenChange={(open) => {
            setInviteDialogOpen(open);
            if (!open) {
              setInviteRole("store_user");
            }
          }}>
            <DialogTrigger asChild>
              <Button data-testid="button-send-invitation">
                <Mail className="h-4 w-4 mr-2" />
                Send Invitation
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Send Invitation</DialogTitle>
                <DialogDescription>
                  Invite a new user to join your company
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSendInvitation}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input id="invite-email" name="email" type="email" required data-testid="input-invite-email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Role</Label>
                    <Select name="role" defaultValue="store_user" onValueChange={setInviteRole} required>
                      <SelectTrigger data-testid="select-invite-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="company_admin">Company Admin</SelectItem>
                        <SelectItem value="store_manager">Store Manager</SelectItem>
                        <SelectItem value="store_user">Store User</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createInvitationMutation.isPending} data-testid="button-submit-invitation">
                    {createInvitationMutation.isPending ? "Sending..." : "Send Invitation"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No pending invitations
                </TableCell>
              </TableRow>
            ) : (
              invitations.map((invitation) => (
                <TableRow key={invitation.id} data-testid={`row-invitation-${invitation.id}`}>
                  <TableCell>{invitation.email}</TableCell>
                  <TableCell>
                    <Badge variant={getRoleBadgeVariant(invitation.role)}>
                      {getRoleLabel(invitation.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyInvitationLink(invitation.token)}
                        data-testid={`button-copy-invitation-${invitation.id}`}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revokeInvitationMutation.mutate(invitation.id)}
                        disabled={revokeInvitationMutation.isPending}
                        data-testid={`button-revoke-invitation-${invitation.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    </>
  );
}
