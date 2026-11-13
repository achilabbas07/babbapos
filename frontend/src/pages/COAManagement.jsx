import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Layers, List, ListFilter, Pencil, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import AccountTransactionsModal from "@/components/AccountTransactionsModal";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import COAFormModal from "@/components/COAFormModal";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errMsg, rp } from "@/lib/api";
import { createAccount, deleteAccount, getAccounts, updateAccount } from "@/services/coaService";
import { attachAccountHeaders, fetchAccountHeaders } from "@/services/coaHeaderService";
import { getAccountCategoryLabel, getAccountTypeLabel } from "@/lib/accountClassification";
import {
  COA_HEADER_FALLBACK_LABEL,
  getAccountHeader,
  groupAccountsByHeader,
} from "@/lib/coaGrouping";

const EMPTY_RANGE = { startDate: "", endDate: "" };

export default function COAManagement() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingAccount, setEditingAccount] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliedRange, setAppliedRange] = useState(EMPTY_RANGE);
  const [detailAccount, setDetailAccount] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [groupByHeader, setGroupByHeader] = useState(true);

  /**
   * Muat akun lalu lengkapi kolom `header` dari Supabase (read-only).
   * Endpoint COA backend belum mengirim `header`, jadi pengayaan ini bersifat
   * best-effort: kegagalannya tidak pernah menggagalkan halaman.
   */
  const loadAccounts = useCallback(async (range = EMPTY_RANGE) => {
    setLoading(true);
    setError("");
    try {
      const [rows, headers] = await Promise.all([
        getAccounts(range),
        fetchAccountHeaders(),
      ]);
      setAccounts(attachAccountHeaders(rows, headers));
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts(EMPTY_RANGE);
  }, [loadAccounts]);

  const applyFilter = (event) => {
    event.preventDefault();
    if (startDate && endDate && endDate < startDate) {
      toast.error("Tanggal selesai tidak boleh sebelum tanggal mulai.");
      return;
    }
    const range = { startDate, endDate };
    setAppliedRange(range);
    loadAccounts(range);
  };

  const resetFilter = () => {
    setStartDate("");
    setEndDate("");
    setAppliedRange(EMPTY_RANGE);
    loadAccounts(EMPTY_RANGE);
  };

  const openDetailModal = (account) => {
    setDetailAccount(account);
    setDetailOpen(true);
  };

  const hasFilter = Boolean(appliedRange.startDate || appliedRange.endDate);
  const groupedAccounts = useMemo(() => groupAccountsByHeader(accounts), [accounts]);

  const openCreateModal = () => {
    setEditingAccount(null);
    setModalOpen(true);
  };

  const openEditModal = (account) => {
    setEditingAccount(account);
    setModalOpen(true);
  };

  const saveAccount = async (account) => {
    if (editingAccount) {
      await updateAccount(editingAccount.id, account);
      toast.success("Akun berhasil diperbarui.");
    } else {
      await createAccount(account);
      toast.success("Akun berhasil ditambahkan.");
    }
    await loadAccounts(appliedRange);
  };

  const removeAccount = async (account) => {
    await deleteAccount(account.id);
    toast.success("Akun berhasil dihapus.");
    await loadAccounts(appliedRange);
  };

  const renderAccountRow = (account, { showHeader = false } = {}) => {
    const header = showHeader ? getAccountHeader(account) : "";
    return (
    <TableRow
      key={account.id}
      data-testid={`coa-row-${account.id}`}
      onClick={() => openDetailModal(account)}
      className="cursor-pointer"
      title={`Lihat rincian transaksi ${account.account_name}`}
    >
      <TableCell className="font-mono">{account.account_code}</TableCell>
      <TableCell className="font-medium">
        {account.account_name}
        {header && (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            {header}
          </span>
        )}
      </TableCell>
      <TableCell>{getAccountTypeLabel(account)}</TableCell>
      <TableCell>{getAccountCategoryLabel(account)}</TableCell>
      <TableCell className="text-right font-mono">{rp(account.current_balance)}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid={`coa-detail-${account.id}`}
            aria-label={`Lihat rincian transaksi ${account.account_name}`}
            onClick={() => openDetailModal(account)}
          >
            <ListFilter className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid={`coa-edit-${account.id}`}
            aria-label={`Edit ${account.account_name}`}
            onClick={() => openEditModal(account)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <ConfirmDelete
            testid={`coa-delete-${account.id}`}
            title={`Hapus ${account.account_name}?`}
            description="Akun yang sudah dipakai dalam transaksi tidak dapat dihapus."
            onConfirm={() => removeAccount(account)}
          />
        </div>
      </TableCell>
    </TableRow>
    );
  };

  return (
    <div>
      <PageHeader title="Chart of Accounts" subtitle="Kelola kode, nama, dan kelompok akun keuangan.">
        <Button
          data-testid="coa-group-toggle"
          variant="outline"
          onClick={() => setGroupByHeader((current) => !current)}
          aria-pressed={groupByHeader}
        >
          {groupByHeader ? <List className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
          {groupByHeader ? "Tampilan Datar" : "Kelompokkan per Header"}
        </Button>
        <Button data-testid="coa-refresh" variant="outline" onClick={() => loadAccounts(appliedRange)} disabled={loading}>
          <RefreshCw className="h-4 w-4" />Perbarui
        </Button>
        <Button data-testid="coa-add" onClick={openCreateModal}>
          <Plus className="h-4 w-4" />Tambah Akun
        </Button>
      </PageHeader>

      <form
        onSubmit={applyFilter}
        data-testid="coa-date-filter"
        className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Dari Tanggal
          <input
            type="date"
            data-testid="coa-start-date"
            value={startDate}
            max={endDate || undefined}
            onChange={(event) => setStartDate(event.target.value)}
            className="h-10 cursor-pointer rounded-lg border border-border bg-background px-3"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Sampai Tanggal
          <input
            type="date"
            data-testid="coa-end-date"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => setEndDate(event.target.value)}
            className="h-10 cursor-pointer rounded-lg border border-border bg-background px-3"
          />
        </label>
        <Button type="submit" data-testid="coa-filter-apply" disabled={loading}>
          <ListFilter className="h-4 w-4" />Filter
        </Button>
        {hasFilter && (
          <Button type="button" variant="outline" data-testid="coa-filter-reset" onClick={resetFilter} disabled={loading}>
            <RotateCcw className="h-4 w-4" />Reset
          </Button>
        )}
        <p className="ml-auto text-xs text-muted-foreground">
          {hasFilter
            ? "Saldo akun dihitung dari mutasi pada rentang tanggal terpilih."
            : "Tanpa filter: saldo akun dihitung dari seluruh mutasi."}
        </p>
      </form>

      <section className="overflow-x-auto rounded-2xl border border-border bg-card">
        {error && (
          <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <span>{error}</span>
            <Button type="button" variant="outline" onClick={() => loadAccounts(appliedRange)} disabled={loading}>Coba lagi</Button>
          </div>
        )}
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground" role="status">Memuat daftar akun...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode Akun</TableHead>
                <TableHead>Nama Akun</TableHead>
                <TableHead>Jenis Akun</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-right">{hasFilter ? "Saldo Periode" : "Saldo Saat Ini"}</TableHead>
                <TableHead><span className="sr-only">Aksi</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupByHeader
                ? groupedAccounts.map((group) => (
                    <Fragment key={group.key}>
                      <TableRow className="bg-secondary/60 hover:bg-secondary/60">
                        <TableCell colSpan={6} className="font-semibold">
                          <span className="flex flex-wrap items-center gap-2" data-testid={`coa-group-${group.key}`}>
                            {group.category}
                            {group.typeLabel && (
                              <span className="text-xs font-normal text-muted-foreground">
                                ({group.typeLabel})
                              </span>
                            )}
                            <span className="text-xs font-normal text-muted-foreground">
                              {group.count} akun · {rp(group.total)}
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                      {group.subgroups.map((subgroup) => (
                        <Fragment key={subgroup.key}>
                          {group.showSubgroupHeaders && (
                            <TableRow className="bg-secondary/25 hover:bg-secondary/25">
                              <TableCell
                                colSpan={6}
                                className="py-2 pl-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                                data-testid={`coa-subgroup-${subgroup.key}`}
                              >
                                {subgroup.header || COA_HEADER_FALLBACK_LABEL}
                                <span className="ml-2 font-normal normal-case">
                                  {subgroup.count} akun · {rp(subgroup.total)}
                                </span>
                              </TableCell>
                            </TableRow>
                          )}
                          {subgroup.accounts.map((account) => renderAccountRow(account))}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))
                : accounts.map((account) => renderAccountRow(account, { showHeader: true }))}
              {accounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Belum ada akun di Chart of Accounts.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </section>

      <COAFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        account={editingAccount}
        onSubmit={saveAccount}
      />

      <AccountTransactionsModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        account={detailAccount}
        range={appliedRange}
      />
    </div>
  );
}
