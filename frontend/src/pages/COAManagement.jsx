import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import COAFormModal from "@/components/COAFormModal";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errMsg, rp } from "@/lib/api";
import { createAccount, deleteAccount, getAccounts, updateAccount } from "@/services/coaService";
import { getAccountCategoryLabel, getAccountTypeLabel } from "@/lib/accountClassification";

export default function COAManagement() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingAccount, setEditingAccount] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setAccounts(await getAccounts());
    } catch (requestError) {
      setError(errMsg(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

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
    await loadAccounts();
  };

  const removeAccount = async (account) => {
    await deleteAccount(account.id);
    toast.success("Akun berhasil dihapus.");
    await loadAccounts();
  };

  return (
    <div>
      <PageHeader title="Chart of Accounts" subtitle="Kelola kode, nama, dan kelompok akun keuangan.">
        <Button data-testid="coa-refresh" variant="outline" onClick={loadAccounts} disabled={loading}>
          <RefreshCw className="h-4 w-4" />Perbarui
        </Button>
        <Button data-testid="coa-add" onClick={openCreateModal}>
          <Plus className="h-4 w-4" />Tambah Akun
        </Button>
      </PageHeader>

      <section className="overflow-x-auto rounded-2xl border border-border bg-card">
        {error && (
          <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <span>{error}</span>
            <Button type="button" variant="outline" onClick={loadAccounts} disabled={loading}>Coba lagi</Button>
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
                <TableHead className="text-right">Saldo Saat Ini</TableHead>
                <TableHead><span className="sr-only">Aksi</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id} data-testid={`coa-row-${account.id}`}>
                  <TableCell className="font-mono">{account.account_code}</TableCell>
                  <TableCell className="font-medium">{account.account_name}</TableCell>
                  <TableCell>{getAccountTypeLabel(account)}</TableCell>
                  <TableCell>{getAccountCategoryLabel(account)}</TableCell>
                  <TableCell className="text-right font-mono">{rp(account.current_balance)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
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
              ))}
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
    </div>
  );
}
