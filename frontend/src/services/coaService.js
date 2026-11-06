import { api } from "@/lib/api";

const ENDPOINT = "/chart-of-accounts";

const buildDateParams = ({ startDate, endDate } = {}) => {
  const params = {};
  if (startDate) params.start_date = startDate;
  if (endDate) params.end_date = endDate;
  return params;
};

export async function getAccounts(range) {
  const { data } = await api.get(ENDPOINT, { params: buildDateParams(range) });
  if (!Array.isArray(data)) {
    throw new Error("Respons daftar akun dari server tidak valid.");
  }
  return data;
}

export async function getAccountTransactions(accountCode, range) {
  const code = String(accountCode ?? "").trim();
  if (!code) {
    throw new Error("Kode akun wajib diisi.");
  }
  const { data } = await api.get(`${ENDPOINT}/${encodeURIComponent(code)}/transactions`, {
    params: buildDateParams(range),
  });
  if (!data || !Array.isArray(data.transactions)) {
    throw new Error("Respons rincian transaksi akun dari server tidak valid.");
  }
  return data;
}

export async function createAccount(account) {
  const { data } = await api.post(ENDPOINT, account);
  return data;
}

export async function updateAccount(id, account) {
  const { data } = await api.put(`${ENDPOINT}/${encodeURIComponent(id)}`, account);
  return data;
}

export async function deleteAccount(id) {
  const { data } = await api.delete(`${ENDPOINT}/${encodeURIComponent(id)}`);
  return data;
}
