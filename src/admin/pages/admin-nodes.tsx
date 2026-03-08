import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adminGetNodeMemberships,
  adminGetAuthCodes,
  adminGetAuthCodeStats,
  adminBatchCreateAuthCodes,
  adminDeactivateAuthCode,
} from "@/admin/admin-api";
import { useAdminAuth } from "@/admin/admin-auth";
import { shortenAddress, formatUSD } from "@/lib/constants";

const PAGE_SIZE = 20;

function authCodeStatusBadge(status: string, usedByWallet?: string) {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">
          ACTIVE
        </Badge>
      );
    case "USED":
      return (
        <div className="flex items-center gap-1.5">
          <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">
            USED
          </Badge>
          {usedByWallet && (
            <span className="font-mono text-[10px] text-foreground/40">
              {shortenAddress(usedByWallet)}
            </span>
          )}
        </div>
      );
    case "INACTIVE":
      return (
        <Badge className="bg-red-500/15 text-red-400 border-red-500/20">
          INACTIVE
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function AdminNodes() {
  const { t } = useTranslation();
  const { adminUser } = useAdminAuth();
  const queryClient = useQueryClient();

  // Node memberships state
  const [nodePage, setNodePage] = useState(1);

  // Auth codes state
  const [codePage, setCodePage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [batchCount, setBatchCount] = useState("10");
  const [batchPrefix, setBatchPrefix] = useState("");
  const [batchNodeType, setBatchNodeType] = useState("light");

  // Queries
  const { data: nodeData, isLoading: nodesLoading } = useQuery({
    queryKey: ["admin", "node-memberships", nodePage],
    queryFn: () => adminGetNodeMemberships(nodePage, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const { data: codeData, isLoading: codesLoading } = useQuery({
    queryKey: ["admin", "auth-codes", codePage],
    queryFn: () => adminGetAuthCodes(codePage, PAGE_SIZE),
    enabled: !!adminUser,
  });

  const { data: codeStats } = useQuery({
    queryKey: ["admin", "auth-code-stats"],
    queryFn: () => adminGetAuthCodeStats(),
    enabled: !!adminUser,
  });

  // Mutations
  const batchCreateMutation = useMutation({
    mutationFn: () =>
      adminBatchCreateAuthCodes(
        Number(batchCount),
        batchNodeType,
        batchPrefix,
        adminUser ?? "admin"
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "auth-codes"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "auth-code-stats"] });
      setDialogOpen(false);
      setBatchCount("10");
      setBatchPrefix("");
      setBatchNodeType("light");
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => adminDeactivateAuthCode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "auth-codes"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "auth-code-stats"] });
    },
  });

  const memberships = nodeData?.data ?? [];
  const nodeTotal = nodeData?.total ?? 0;
  const nodeTotalPages = Math.ceil(nodeTotal / PAGE_SIZE);

  const codes = codeData?.data ?? [];
  const codeTotal = codeData?.total ?? 0;
  const codeTotalPages = Math.ceil(codeTotal / PAGE_SIZE);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold text-foreground">
        {t("admin.nodes", "Nodes")}
      </h1>

      {/* ===== Section A: Node Memberships ===== */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground/80">
          {t("admin.nodeMemberships", "Node Memberships")}
        </h2>

        <div
          className="rounded-2xl border border-border/30 backdrop-blur-sm overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
          }}
        >
          {nodesLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/20 hover:bg-transparent">
                  <TableHead>{t("admin.userWallet", "User Wallet")}</TableHead>
                  <TableHead>{t("admin.nodeType", "Node Type")}</TableHead>
                  <TableHead>{t("admin.price", "Price")}</TableHead>
                  <TableHead>{t("admin.status", "Status")}</TableHead>
                  <TableHead>{t("admin.startDate", "Start Date")}</TableHead>
                  <TableHead>{t("admin.milestoneStage", "Milestone Stage")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-foreground/40 py-8">
                      {t("admin.noData", "No data found")}
                    </TableCell>
                  </TableRow>
                ) : (
                  memberships.map((node: any) => (
                    <TableRow key={node.id} className="border-border/10">
                      <TableCell className="font-mono text-xs text-foreground/70">
                        {shortenAddress(node.userWallet ?? node.userId)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {node.nodeType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-foreground/70">
                        {formatUSD(Number(node.price))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            node.status === "active"
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                              : "bg-gray-500/15 text-gray-400 border-gray-500/20"
                          }
                        >
                          {node.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-foreground/40 text-xs">
                        {node.startDate
                          ? new Date(node.startDate).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-foreground/70">
                        {node.milestoneStage} / {node.totalMilestones}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>

        {nodeTotalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground/40">
              {t("admin.pageInfo", "Page {{page}} of {{total}}", {
                page: nodePage,
                total: nodeTotalPages,
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNodePage((p) => Math.max(1, p - 1))}
                disabled={nodePage <= 1}
              >
                {t("admin.prev", "Prev")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNodePage((p) => Math.min(nodeTotalPages, p + 1))}
                disabled={nodePage >= nodeTotalPages}
              >
                {t("admin.next", "Next")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ===== Section B: Authorization Codes ===== */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground/80">
            {t("admin.authCodes", "Authorization Codes")}
          </h2>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t("admin.batchGenerate", "Batch Generate")}
          </Button>
        </div>

        {/* Stats Bar */}
        {codeStats && (
          <div className="flex items-center gap-6 px-5 py-3 rounded-xl border border-border/20 bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground/40">
                {t("admin.totalCodes", "Total")}:
              </span>
              <span className="text-sm font-semibold text-foreground">
                {codeStats.total ?? 0}
              </span>
              <span className="text-xs text-foreground/30">/ 2000</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground/40">
                {t("admin.usedCodes", "Used")}:
              </span>
              <span className="text-sm font-semibold text-amber-400">
                {codeStats.used ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground/40">
                {t("admin.availableCodes", "Available")}:
              </span>
              <span className="text-sm font-semibold text-emerald-400">
                {codeStats.available ?? 0}
              </span>
            </div>
          </div>
        )}

        {/* Auth Codes Table */}
        <div
          className="rounded-2xl border border-border/30 backdrop-blur-sm overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
          }}
        >
          {codesLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/20 hover:bg-transparent">
                  <TableHead>{t("admin.code", "Code")}</TableHead>
                  <TableHead>{t("admin.nodeType", "Node Type")}</TableHead>
                  <TableHead>{t("admin.status", "Status")}</TableHead>
                  <TableHead>{t("admin.createdBy", "Created By")}</TableHead>
                  <TableHead>{t("admin.usedByWallet", "Used By")}</TableHead>
                  <TableHead>{t("admin.usedAt", "Used At")}</TableHead>
                  <TableHead>{t("admin.actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-foreground/40 py-8">
                      {t("admin.noData", "No data found")}
                    </TableCell>
                  </TableRow>
                ) : (
                  codes.map((code: any) => (
                    <TableRow key={code.id} className="border-border/10">
                      <TableCell className="font-mono text-xs text-foreground/70 font-semibold">
                        {code.code}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {code.nodeType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {authCodeStatusBadge(code.status, code.usedByWallet)}
                      </TableCell>
                      <TableCell className="text-foreground/50 text-xs">
                        {code.createdBy}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-foreground/40">
                        {code.usedByWallet ? shortenAddress(code.usedByWallet) : "-"}
                      </TableCell>
                      <TableCell className="text-foreground/40 text-xs">
                        {code.usedAt
                          ? new Date(code.usedAt).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {code.status?.toUpperCase() === "ACTIVE" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20 h-7 text-xs"
                            onClick={() => deactivateMutation.mutate(code.id)}
                            disabled={deactivateMutation.isPending}
                          >
                            {t("admin.deactivate", "Deactivate")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>

        {codeTotalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground/40">
              {t("admin.pageInfo", "Page {{page}} of {{total}}", {
                page: codePage,
                total: codeTotalPages,
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCodePage((p) => Math.max(1, p - 1))}
                disabled={codePage <= 1}
              >
                {t("admin.prev", "Prev")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCodePage((p) => Math.min(codeTotalPages, p + 1))}
                disabled={codePage >= codeTotalPages}
              >
                {t("admin.next", "Next")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ===== Batch Generate Dialog ===== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin.batchGenerateCodes", "Batch Generate Authorization Codes")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "admin.batchGenerateDesc",
                "Generate multiple authorization codes at once. Codes will follow the format: PREFIX + 8 random uppercase characters."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/70">
                {t("admin.count", "Count")}
              </label>
              <Input
                type="number"
                min={1}
                max={100}
                value={batchCount}
                onChange={(e) => setBatchCount(e.target.value)}
                placeholder="10"
                className="bg-background/50 border-border/30"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/70">
                {t("admin.prefix", "Prefix")}
                <span className="text-foreground/30 ml-1">
                  ({t("admin.optional", "optional")})
                </span>
              </label>
              <Input
                value={batchPrefix}
                onChange={(e) => setBatchPrefix(e.target.value.toUpperCase())}
                placeholder="e.g. AX"
                className="bg-background/50 border-border/30"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/70">
                {t("admin.nodeType", "Node Type")}
              </label>
              <Select value={batchNodeType} onValueChange={setBatchNodeType}>
                <SelectTrigger className="bg-background/50 border-border/30">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="super">Super</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={batchCreateMutation.isPending}
            >
              {t("admin.cancel", "Cancel")}
            </Button>
            <Button
              onClick={() => batchCreateMutation.mutate()}
              disabled={batchCreateMutation.isPending || !batchCount || Number(batchCount) < 1}
            >
              {batchCreateMutation.isPending
                ? t("admin.generating", "Generating...")
                : t("admin.generate", "Generate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
