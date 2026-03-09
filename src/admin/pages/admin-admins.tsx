import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Shield, ShieldCheck, ShieldAlert, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MobileDataCard } from "@/admin/components/mobile-card";
import {
  adminGetAdminUsers, adminCreateAdminUser, adminUpdateAdminUser, adminDeleteAdminUser,
} from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";

const ROLE_OPTIONS = [
  { value: "superadmin", label: "超级管理", color: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
  { value: "admin", label: "管理员", color: "bg-primary/15 text-primary border-primary/20" },
  { value: "support", label: "客服", color: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
];

const PERMISSIONS_MAP: Record<string, { label: string; pages: string[] }> = {
  superadmin: {
    label: "全部权限",
    pages: ["概览", "会员", "推荐", "金库", "节点", "授权码", "业绩", "合约", "日志", "管理员"],
  },
  admin: {
    label: "管理权限",
    pages: ["概览", "会员", "推荐", "节点", "业绩", "授权码", "合约(只读)", "日志"],
  },
  support: {
    label: "客服权限",
    pages: ["概览", "会员", "推荐"],
  },
};

function roleBadge(role: string) {
  const r = ROLE_OPTIONS.find((o) => o.value === role);
  return (
    <Badge className={`text-[10px] h-5 ${r?.color || "bg-muted text-muted-foreground"}`}>
      {r?.label || role}
    </Badge>
  );
}

function statusBadge(isActive: boolean) {
  return isActive ? (
    <Badge className="text-[10px] h-5 bg-emerald-500/15 text-emerald-400 border-emerald-500/20">启用</Badge>
  ) : (
    <Badge className="text-[10px] h-5 bg-red-500/15 text-red-400 border-red-500/20">停用</Badge>
  );
}

export default function AdminAdmins() {
  const { adminUser, adminRole } = useAdminAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = adminRole === "superadmin";

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<any>(null);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("support");
  const [showPassword, setShowPassword] = useState(false);

  const [editRole, setEditRole] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);

  const { data: admins = [], isLoading } = useQuery({
    queryKey: ["admin", "admin-users"],
    queryFn: adminGetAdminUsers,
    enabled: !!adminUser && isSuperAdmin,
  });

  const createMutation = useMutation({
    mutationFn: () => adminCreateAdminUser(newUsername, newPassword, newRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "admin-users"] });
      setCreateOpen(false);
      setNewUsername("");
      setNewPassword("");
      setNewRole("support");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; updates: any }) => adminUpdateAdminUser(data.id, data.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "admin-users"] });
      setEditOpen(false);
      setSelectedAdmin(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminDeleteAdminUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "admin-users"] });
      setDeleteOpen(false);
      setSelectedAdmin(null);
    },
  });

  const openEdit = (admin: any) => {
    setSelectedAdmin(admin);
    setEditRole(admin.role);
    setEditActive(admin.isActive);
    setEditPassword("");
    setShowEditPassword(false);
    setEditOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedAdmin) return;
    const updates: any = {};
    if (editRole !== selectedAdmin.role) updates.role = editRole;
    if (editActive !== selectedAdmin.isActive) updates.is_active = editActive;
    if (editPassword.trim()) updates.password = editPassword;
    updateMutation.mutate({ id: selectedAdmin.id, updates });
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg lg:text-xl font-bold text-foreground">
          管理员管理
          {admins.length > 0 && <span className="text-sm font-normal text-foreground/40 ml-2">({admins.length})</span>}
        </h1>
        <Button size="sm" className="h-8 text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加管理员
        </Button>
      </div>

      {/* Permission Overview */}
      <div className="rounded-2xl border border-white/[0.06] p-4" style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)" }}>
        <h3 className="text-sm font-semibold text-foreground/70 mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" /> 权限说明
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.entries(PERMISSIONS_MAP).map(([role, info]) => {
            const roleOpt = ROLE_OPTIONS.find((r) => r.value === role);
            return (
              <div key={role} className="rounded-xl border border-white/[0.06] p-3 space-y-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                <div className="flex items-center gap-2">
                  {role === "superadmin" ? <ShieldAlert className="h-4 w-4 text-amber-400" /> :
                   role === "admin" ? <ShieldCheck className="h-4 w-4 text-primary" /> :
                   <Shield className="h-4 w-4 text-blue-400" />}
                  <Badge className={`text-[10px] h-5 ${roleOpt?.color}`}>{roleOpt?.label}</Badge>
                </div>
                <div className="text-[11px] text-foreground/40">{info.label}</div>
                <div className="flex flex-wrap gap-1">
                  {info.pages.map((p) => (
                    <span key={p} className="text-[10px] bg-white/[0.04] text-foreground/50 px-1.5 py-0.5 rounded">{p}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : (
        <>
          {/* Mobile */}
          <div className="lg:hidden space-y-3">
            {admins.length === 0 ? (
              <p className="text-center text-foreground/40 py-8 text-sm">暂无管理员</p>
            ) : admins.map((a: any) => (
              <MobileDataCard
                key={a.id}
                header={
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground/80">{a.username}</span>
                    <div className="flex items-center gap-1.5">
                      {statusBadge(a.isActive)}
                      {roleBadge(a.role)}
                    </div>
                  </div>
                }
                fields={[
                  { label: "角色", value: roleBadge(a.role) },
                  { label: "状态", value: statusBadge(a.isActive) },
                  { label: "创建时间", value: a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "-" },
                ]}
                actions={
                  a.username !== adminUser ? (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => openEdit(a)}>
                        <Pencil className="h-3 w-3 mr-1" /> 编辑
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
                        onClick={() => { setSelectedAdmin(a); setDeleteOpen(true); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-foreground/30 text-center">当前账号</div>
                  )
                }
              />
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden lg:block rounded-2xl border border-white/[0.06] overflow-x-auto" style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)" }}>
            <Table>
              <TableHeader>
                <TableRow className="border-border/20 hover:bg-transparent">
                  <TableHead>用户名</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-foreground/40 py-8">暂无管理员</TableCell></TableRow>
                ) : admins.map((a: any) => (
                  <TableRow key={a.id} className="border-border/10 hover:bg-white/[0.015]">
                    <TableCell className="font-medium text-foreground/80">{a.username}</TableCell>
                    <TableCell>{roleBadge(a.role)}</TableCell>
                    <TableCell>{statusBadge(a.isActive)}</TableCell>
                    <TableCell className="text-foreground/40 text-xs">{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "-"}</TableCell>
                    <TableCell>
                      {a.username !== adminUser ? (
                        <div className="flex gap-1.5">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openEdit(a)}>
                            <Pencil className="h-3 w-3 mr-1" /> 编辑
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
                            onClick={() => { setSelectedAdmin(a); setDeleteOpen(true); }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-foreground/30">当前账号</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[340px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加管理员</DialogTitle>
            <DialogDescription>创建新的管理员账号</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">用户名</label>
              <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="输入用户名" className="bg-background/50 border-border/30" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">密码</label>
              <div className="flex items-center gap-2">
                <Input type={showPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="输入密码" className="bg-background/50 border-border/30" />
                <Button size="icon" variant="ghost" onClick={() => setShowPassword((v) => !v)} className="shrink-0">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">角色</label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger className="bg-background/50 border-border/30"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newRole && PERMISSIONS_MAP[newRole] && (
              <div className="rounded-lg border border-white/[0.06] p-2.5 space-y-1" style={{ background: "rgba(255,255,255,0.02)" }}>
                <div className="text-[11px] text-foreground/40 font-medium">可访问页面：</div>
                <div className="flex flex-wrap gap-1">
                  {PERMISSIONS_MAP[newRole].pages.map((p) => (
                    <span key={p} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{p}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>取消</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !newUsername.trim() || !newPassword.trim()}>
              {createMutation.isPending ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-[340px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑管理员</DialogTitle>
            <DialogDescription>修改 {selectedAdmin?.username} 的权限和状态</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">角色</label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger className="bg-background/50 border-border/30"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editRole && PERMISSIONS_MAP[editRole] && (
              <div className="rounded-lg border border-white/[0.06] p-2.5 space-y-1" style={{ background: "rgba(255,255,255,0.02)" }}>
                <div className="text-[11px] text-foreground/40 font-medium">可访问页面：</div>
                <div className="flex flex-wrap gap-1">
                  {PERMISSIONS_MAP[editRole].pages.map((p) => (
                    <span key={p} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{p}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">状态</label>
              <Select value={editActive ? "active" : "inactive"} onValueChange={(v) => setEditActive(v === "active")}>
                <SelectTrigger className="bg-background/50 border-border/30"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">启用</SelectItem>
                  <SelectItem value="inactive">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">重置密码（留空不修改）</label>
              <div className="flex items-center gap-2">
                <Input type={showEditPassword ? "text" : "password"} value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="输入新密码" className="bg-background/50 border-border/30" />
                <Button size="icon" variant="ghost" onClick={() => setShowEditPassword((v) => !v)} className="shrink-0">
                  {showEditPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={updateMutation.isPending}>取消</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-[340px] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除管理员 <strong>{selectedAdmin?.username}</strong> 吗？此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteMutation.isPending}>取消</Button>
            <Button variant="destructive" onClick={() => selectedAdmin && deleteMutation.mutate(selectedAdmin.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "删除中..." : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
