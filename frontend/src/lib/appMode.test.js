import {
  OPERATIONAL_HOME,
  OWNER_HOME,
  filterOwnerModeLoginUsers,
  homePathFor,
  isOwnerAccount,
  isOwnerMode,
  isOwnerRole,
} from "./appMode";

describe("mode aplikasi (operasional vs Owner)", () => {
  it("mengenali nilai variabel yang menandakan Mode Owner", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", " 1 "]) {
      expect(isOwnerMode(value)).toBe(true);
    }
    for (const value of ["", "0", "false", "off", undefined, null, "owner"]) {
      expect(isOwnerMode(value)).toBe(false);
    }
  });

  it("mengarahkan setiap sesi yang sah ke halaman pantauan pada Mode Owner", () => {
    expect(homePathFor({ role: "admin" }, true)).toBe(OWNER_HOME);
    // Akun non-pemilik juga diarahkan ke pantauan; penjaga rute yang menolaknya.
    expect(homePathFor({ role: "kasir" }, true)).toBe(OWNER_HOME);
    expect(homePathFor({ role: "waiter" }, true)).toBe(OWNER_HOME);
    expect(homePathFor(null, true)).toBe(OPERATIONAL_HOME);
  });

  it("selalu kembali ke kasir pada build operasional (Mode Owner mati)", () => {
    expect(homePathFor({ role: "admin" }, false)).toBe(OPERATIONAL_HOME);
    expect(homePathFor({ role: "kasir" }, false)).toBe(OPERATIONAL_HOME);
  });

  it("menganggap hanya peran admin sebagai akun owner", () => {
    expect(isOwnerAccount({ role: "admin" })).toBe(true);
    expect(isOwnerAccount({ role: "kasir" })).toBe(false);
    expect(isOwnerAccount(undefined)).toBe(false);
  });

  it("memakai halaman pantauan /owner yang berbeda dari kasir", () => {
    expect(OWNER_HOME).toBe("/owner");
    expect(OPERATIONAL_HOME).toBe("/pos");
    expect(OWNER_HOME).not.toBe(OPERATIONAL_HOME);
  });
});

describe("filter username login (khusus APK Mode Owner)", () => {
  const USERS = [
    { id: "U-1", name: "Pemilik", role: "admin" },
    { id: "U-2", name: "Kasir", role: "kasir" },
    { id: "U-3", name: "Pelayan", role: "waiter" },
    { id: "U-4", name: "Admin Dua", role: "ADMIN" },
  ];

  it("mengenali peran admin tanpa peduli besar-kecil huruf dan spasi", () => {
    for (const role of ["admin", "Admin", "ADMIN", " admin "]) {
      expect(isOwnerRole(role)).toBe(true);
    }
    for (const role of ["kasir", "waiter", "pelayan", "", undefined, null, "administrator"]) {
      expect(isOwnerRole(role)).toBe(false);
    }
  });

  it("HANYA menampilkan akun admin saat Mode Owner aktif", () => {
    const filtered = filterOwnerModeLoginUsers(USERS, true);
    expect(filtered.map((u) => u.id)).toEqual(["U-1", "U-4"]);
    expect(filtered.every((u) => isOwnerRole(u.role))).toBe(true);
  });

  it("TIDAK mengubah daftar pada build operasional (Mode Owner mati)", () => {
    expect(filterOwnerModeLoginUsers(USERS, false)).toEqual(USERS);
    expect(filterOwnerModeLoginUsers(USERS, false)).toHaveLength(4);
  });

  it("aman terhadap daftar kosong / bukan array", () => {
    expect(filterOwnerModeLoginUsers(undefined, true)).toEqual([]);
    expect(filterOwnerModeLoginUsers(null, true)).toEqual([]);
    expect(filterOwnerModeLoginUsers("bukan array", false)).toEqual([]);
  });
});
