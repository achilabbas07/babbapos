import { roleRequiresWaiter, hasSelectedWaiter, waiterValidationMessage } from "./orderValidation";

describe("validasi pelayan berdasarkan role", () => {
  describe("roleRequiresWaiter", () => {
    it("mewajibkan pelayan untuk Kasir dan Admin", () => {
      expect(roleRequiresWaiter("kasir")).toBe(true);
      expect(roleRequiresWaiter("admin")).toBe(true);
      expect(roleRequiresWaiter("Kasir")).toBe(true);
      expect(roleRequiresWaiter(" ADMIN ")).toBe(true);
    });

    it("tidak mewajibkan pelayan untuk role waiter dan role lain", () => {
      expect(roleRequiresWaiter("waiter")).toBe(false);
      expect(roleRequiresWaiter("")).toBe(false);
      expect(roleRequiresWaiter(null)).toBe(false);
      expect(roleRequiresWaiter(undefined)).toBe(false);
    });
  });

  describe("hasSelectedWaiter", () => {
    it("menganggap pelayan terpilih bila waiterId berisi id", () => {
      expect(hasSelectedWaiter({ waiterId: "w-1" })).toBe(true);
    });

    it("menganggap belum terpilih untuk null, kosong, atau none", () => {
      expect(hasSelectedWaiter({ waiterId: null })).toBe(false);
      expect(hasSelectedWaiter({ waiterId: "" })).toBe(false);
      expect(hasSelectedWaiter({ waiterId: "none" })).toBe(false);
      expect(hasSelectedWaiter({})).toBe(false);
      expect(hasSelectedWaiter(null)).toBe(false);
    });
  });

  describe("waiterValidationMessage", () => {
    it("memberi pesan bila Kasir/Admin belum memilih pelayan", () => {
      expect(waiterValidationMessage("kasir", { waiterId: null })).toMatch(/pelayan wajib dipilih/i);
      expect(waiterValidationMessage("admin", { waiterId: "none" })).toMatch(/pelayan wajib dipilih/i);
    });

    it("lolos validasi bila Kasir/Admin sudah memilih pelayan", () => {
      expect(waiterValidationMessage("kasir", { waiterId: "w-1" })).toBeNull();
      expect(waiterValidationMessage("admin", { waiterId: "w-1" })).toBeNull();
    });

    it("tidak mengganggu role waiter meski pelayan kosong", () => {
      expect(waiterValidationMessage("waiter", { waiterId: null })).toBeNull();
      expect(waiterValidationMessage("waiter", { waiterId: "none" })).toBeNull();
    });
  });
});
