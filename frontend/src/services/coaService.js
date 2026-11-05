import { api } from "@/lib/api";

const ENDPOINT = "/chart-of-accounts";

export async function getAccounts() {
  const { data } = await api.get(ENDPOINT);
  if (!Array.isArray(data)) {
    throw new Error("Respons daftar akun dari server tidak valid.");
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
